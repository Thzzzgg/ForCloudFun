// 點擊水面產生的漣漪與水花（不依賴 WebGL 與 Web Audio）
//
// 漣漪：深水重力波的色散關係 ω² = gk 讓一個點的擾動散成一圈圈的環，長波跑得快、在外圈，短波慢、留在內圈。
// 用 Cauchy–Poisson 問題（靜止水面上一個高斯形凹陷放開後的演變）的穩相近似解：
// 距離 r、經過 t 秒時，主要是群速度等於 r / t 的那個波數 k = g t² / (4 r²)，
//   η(r, t) ≈ −A a² · exp(−k² a² / 4) · k^(5/4) / √(r t √g) · cos(k r)
// A 為凹陷的深度、a 為半徑；a 決定主要的波長（振幅最大的波數為 √3 / a）。
// shaders/ripples.glsl 用同樣的式子算法線，這裡的版本給單元測試用

export const MAX_RIPPLES = 8; // 同時存在的漣漪數，需與 shaders/ripples.glsl 一致
export const RIPPLE_LIFE = 15; // 漣漪持續的秒數，需與 shaders/ripples.glsl 一致
export const RIPPLE_RADIUS = 0.4; // 初始凹陷的半徑 a（公尺），需與 shaders/ripples.glsl 一致
export const RIPPLE_DEPTH = 0.6; // 初始凹陷的深度 A（公尺）：像丟進一顆不小的石頭
export const MAX_DROPLETS = 1024; // 同時存在的水花粒子數

const GRAVITY = 9.81;

// 漣漪在距離 r（公尺）、經過 t 秒時的水面高度、徑向坡度 ∂η/∂r 與當地的波數
export function rippleAt(r, t, depth = RIPPLE_DEPTH, radius = RIPPLE_RADIUS) {
  r = Math.max(r, 1e-3);
  t = Math.max(t, 1e-3);
  const k = (GRAVITY * t * t) / (4 * r * r);
  const amplitude = (depth * radius * radius * Math.exp(-0.25 * k * k * radius * radius) * k ** 1.25)
    / Math.sqrt(r * t * Math.sqrt(GRAVITY));
  return {
    height: -amplitude * Math.cos(k * r),
    slope: -amplitude * k * Math.sin(k * r), // 振幅本身隨距離的變化比相位慢得多，略去
    wavenumber: k,
  };
}

// 目前的漣漪：最多 MAX_RIPPLES 個，太多時取代最舊的；位置用海面的靜止座標，漣漪才會跟著浪起伏、變形
export class Ripples {
  constructor() {
    this.list = [];
    this.data = new Float32Array(MAX_RIPPLES * 4);
  }

  add(x, z, time, depth = RIPPLE_DEPTH) {
    if (this.list.length >= MAX_RIPPLES) this.list.shift();
    this.list.push({ x, z, start: time, depth });
  }

  // 傳給著色器的資料：每個漣漪一組 (x, z, 經過的秒數, 深度)，過期的先移除；回傳 { data, count }
  pack(time) {
    this.list = this.list.filter((ripple) => time - ripple.start < RIPPLE_LIFE && time >= ripple.start);
    this.data.fill(0);
    this.list.forEach((ripple, i) => this.data.set([ripple.x, ripple.z, time - ripple.start, ripple.depth], i * 4));
    return { data: this.data, count: this.list.length };
  }
}

// 水花的三種粒子：
// - 水冠：落水處往四周斜斜噴出的一圈水滴
// - 水柱：凹陷回填時從中央往上衝的一束水滴，比水冠晚一點出現
// - 水霧：慢慢散開、很淡的一團細小水滴
// count 為每次的數量；angle 為仰角範圍（度）；speed 為初速範圍（m/s）；size 為方塊半徑範圍（公尺）
const SPLASH_PARTS = [
  { count: 160, angle: [40, 78], speed: [2, 4.6], size: [0.012, 0.035], opacity: 0.75, delay: [0, 0.03], spread: [0.15, 0.4], drag: 0.3, gravity: 1 },
  { count: 50, angle: [80, 90], speed: [2.6, 5.8], size: [0.015, 0.04], opacity: 0.8, delay: [0.12, 0.3], spread: [0, 0.1], drag: 0.3, gravity: 1 },
  { count: 14, angle: [40, 85], speed: [0.6, 1.6], size: [0.2, 0.45], opacity: 0.14, delay: [0, 0.1], spread: [0.1, 0.4], drag: 2, gravity: 0.15 },
];
const MAX_AGE = 3; // 粒子最長存活的秒數（水霧不一定會落回水面）

const between = ([low, high], random) => low + (high - low) * random();

// 水花粒子：在 CPU 上模擬（數量很少），每幀把狀態打包上傳給 GPU 繪製
export class Droplets {
  constructor(capacity = MAX_DROPLETS) {
    this.capacity = capacity;
    this.count = 0;
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity); // 負值代表還沒出現（水柱比水冠晚噴出）
    this.size = new Float32Array(capacity);
    this.opacity = new Float32Array(capacity);
    this.floor = new Float32Array(capacity); // 落到這個高度（水面）就消失
    this.drag = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
  }

  // 在海面上的 center [x, y, z] 濺起一次水花；strength 讓水花大一點或小一點（約 0.5～1.5）
  spawn(center, { strength = 1, random = Math.random } = {}) {
    for (const part of SPLASH_PARTS) {
      for (let n = 0; n < part.count; n++) {
        if (this.count >= this.capacity) return;
        const i = this.count++;
        const azimuth = random() * 2 * Math.PI;
        const elevation = (between(part.angle, random) * Math.PI) / 180;
        const speed = between(part.speed, random) * Math.sqrt(strength);
        const spread = between(part.spread, random);
        const [dx, dz] = [Math.cos(azimuth), Math.sin(azimuth)];
        this.position.set([center[0] + dx * spread, center[1] + 0.05, center[2] + dz * spread], i * 3);
        this.velocity.set([dx * speed * Math.cos(elevation), speed * Math.sin(elevation), dz * speed * Math.cos(elevation)], i * 3);
        this.age[i] = -between(part.delay, random);
        this.size[i] = between(part.size, random);
        this.opacity[i] = part.opacity;
        this.floor[i] = center[1] - 0.05;
        this.drag[i] = part.drag;
        this.gravity[i] = part.gravity * GRAVITY;
      }
    }
  }

  // 受重力與空氣阻力移動；落回水面或太久的粒子移除（拿最後一顆補上空位）
  update(deltaTime) {
    let i = 0;
    while (i < this.count) {
      const wasHidden = this.age[i] < 0;
      this.age[i] += deltaTime;
      if (!wasHidden) {
        const p = i * 3;
        const keep = Math.exp(-this.drag[i] * deltaTime);
        this.velocity[p] *= keep;
        this.velocity[p + 2] *= keep;
        this.velocity[p + 1] = this.velocity[p + 1] * keep - this.gravity[i] * deltaTime;
        for (let k = 0; k < 3; k++) this.position[p + k] += this.velocity[p + k] * deltaTime;
      }
      if (this.position[i * 3 + 1] < this.floor[i] || this.age[i] > MAX_AGE) {
        this.remove(i);
      } else {
        i++;
      }
    }
  }

  remove(i) {
    const last = --this.count;
    if (i === last) return;
    this.position.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
    for (const array of [this.age, this.size, this.opacity, this.floor, this.drag, this.gravity]) array[i] = array[last];
  }

  // 打包成每顆 8 個數的繪製資料：(x, y, z, 半徑), (vx, vy, vz, 不透明度)；還沒出現的粒子略過。回傳寫入的顆數
  pack(out) {
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] < 0) continue;
      const p = i * 3;
      // 剛噴出時很快淡入，水霧則在後半段慢慢淡出
      const fadeIn = Math.min(this.age[i] / 0.03, 1);
      const fadeOut = this.drag[i] > 1 ? 1 - Math.min(this.age[i] / 1.6, 1) : 1;
      out.set([
        this.position[p], this.position[p + 1], this.position[p + 2], this.size[i],
        this.velocity[p], this.velocity[p + 1], this.velocity[p + 2], this.opacity[i] * fadeIn * fadeOut,
      ], n * 8);
      n++;
    }
    return n;
  }
}
