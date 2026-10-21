// 海鷗：幾隻海鷗在浮標附近盤旋，滑翔為主、偶爾拍翅，轉彎時側傾；夜晚與暴風時飛走，天氣好轉再飛回來
// GullFlock 是飛行模型（不依賴 WebGL），Gulls 負責繪製：翅膀的拍動在頂點著色器（shaders/gull.vert）計算
import { setEnvironmentUniforms } from './sky.js';

export const GULL_COUNT = 6;
const GRAVITY = 9.81;
const PRESENCE_TIME = 45; // 飛走或飛回來要花的秒數
const LEAVE_DISTANCE = 350; // 飛走時離開盤旋處的距離（公尺）
const FLAP_FREQUENCY = 3.2; // 拍翅的頻率（Hz）

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

// 天氣對海鷗的吸引力（0～1）：白天才出來，風太大（蒲福 8 級以上）就去避風
export function gullWelcome({ sunElevation, windSpeed }) {
  return smoothstep(-0.05, 0.1, sunElevation) * (1 - smoothstep(15, 22, windSpeed));
}

// 海鷗的飛行模型：每隻繞著自己的圓圈盤旋，圓心隨風慢慢漂移、離家太遠就被拉回來，
// 半徑與高度緩慢變化；側傾角由轉彎的向心加速度決定（tan 側傾 = v·ω / g）
export class GullFlock {
  // home：盤旋的中心附近（浮標的 x, z）；random 可傳入可重現的亂數
  constructor({ home = [0, 0], count = GULL_COUNT, random = Math.random } = {}) {
    this.home = home;
    this.random = random;
    this.time = 0;
    this.started = false;
    this.nextCall = 3 + random() * 8;
    this.gulls = Array.from({ length: count }, (_, i) => this.createGull(i, count));
  }

  createGull(i, count) {
    const r = this.random;
    const angle = (i / count) * 2 * Math.PI + r() * 0.8;
    const distance = 10 + r() * 25;
    const exit = r() * 2 * Math.PI;
    return {
      center: [this.home[0] + Math.cos(angle) * distance, this.home[1] + Math.sin(angle) * distance],
      radius: 14 + r() * 16,
      direction: r() < 0.5 ? 1 : -1,
      angle: r() * 2 * Math.PI,
      altitude: 7 + r() * 13,
      speed: 9 + r() * 3,
      phase: r() * 100,
      threshold: (i + 0.5) / count, // 天氣越好，出現的隻數越多
      exit: [Math.cos(exit), Math.sin(exit)],
      presence: 0,
      flap: 0,
      flapPhase: r() * 2 * Math.PI,
      burstEnd: 0,
      nextBurst: r() * 6,
      position: null,
      yaw: 0,
      pitch: 0,
      roll: 0,
    };
  }

  // 可以看到的海鷗（還沒完全飛走的）
  get visible() {
    return this.gulls.filter((gull) => gull.presence > 0);
  }

  // conditions：{ sunElevation（太陽方向的 y 分量）, windSpeed, wind: [x, z] }
  // 回傳這段時間內的叫聲 [{ position, notes, pitch }]
  update(deltaTime, { sunElevation, windSpeed, wind = [0, 0] }) {
    const calls = [];
    if (deltaTime <= 0) return calls;
    this.time += deltaTime;
    const welcome = gullWelcome({ sunElevation, windSpeed });
    for (const gull of this.gulls) {
      const target = welcome > gull.threshold ? 1 : 0;
      // 一開始就照當時的天氣決定在不在，之後才慢慢飛走或飛回來
      gull.presence = this.started ? approach(gull.presence, target, deltaTime / PRESENCE_TIME) : target;
      this.fly(gull, deltaTime, wind);
    }
    this.started = true;

    const present = this.gulls.filter((gull) => gull.presence > 0.8);
    if (this.time >= this.nextCall) {
      this.nextCall = this.time + 6 + this.random() * 16;
      if (present.length) {
        const caller = present[Math.floor(this.random() * present.length)];
        calls.push({ position: [...caller.position], notes: 2 + Math.floor(this.random() * 4), pitch: 0.9 + this.random() * 0.25 });
      }
    }
    return calls;
  }

  fly(gull, dt, wind) {
    const t = this.time;
    const previous = gull.position;
    // 圓心順著風慢慢漂移，離家超過 40 公尺就往回拉
    const offset = [gull.center[0] - this.home[0], gull.center[1] - this.home[1]];
    const pull = Math.max(Math.hypot(...offset) - 40, 0) * 0.05;
    const length = Math.hypot(...offset) || 1;
    gull.center[0] += (wind[0] * 0.08 - (offset[0] / length) * pull) * dt;
    gull.center[1] += (wind[1] * 0.08 - (offset[1] / length) * pull) * dt;

    const radius = gull.radius * (1 + 0.25 * Math.sin(0.05 * t + gull.phase));
    gull.angle += (gull.direction * gull.speed * dt) / radius;
    const altitude = Math.min(Math.max(gull.altitude + 3 * Math.sin(0.11 * t + gull.phase) + 1.5 * Math.sin(0.29 * t + 2 * gull.phase), 3), 30);
    // 飛走時邊盤旋邊往遠處爬升
    const away = LEAVE_DISTANCE * (1 - gull.presence) ** 2;
    const position = [
      gull.center[0] + Math.cos(gull.angle) * radius + gull.exit[0] * away,
      altitude + away * 0.15,
      gull.center[1] + Math.sin(gull.angle) * radius + gull.exit[1] * away,
    ];
    gull.position = position;
    if (!previous) return;

    // 由位置的變化求出航向、俯仰與側傾
    const velocity = position.map((v, i) => (v - previous[i]) / dt);
    const horizontal = Math.hypot(velocity[0], velocity[2]);
    if (horizontal < 1e-3) return;
    const yaw = Math.atan2(velocity[0], velocity[2]);
    const yawRate = wrapAngle(yaw - gull.yaw) / dt;
    gull.yaw = yaw;
    gull.pitch = Math.max(Math.min(Math.atan2(velocity[1], horizontal), 0.5), -0.5);
    // 往左轉（航向角增加）時往左傾：左翼（模型的 +x）朝下
    const bank = -Math.atan((horizontal * yawRate) / GRAVITY);
    gull.roll += (Math.max(Math.min(bank, 0.8), -0.8) - gull.roll) * Math.min(dt / 0.3, 1);

    // 爬升、飛走或飛回來時拍翅；其餘時間大多在滑翔，偶爾拍幾下
    if (t >= gull.nextBurst) {
      gull.burstEnd = t + 1.2 + this.random() * 1.5;
      gull.nextBurst = gull.burstEnd + 3 + this.random() * 7;
    }
    const flapping = t < gull.burstEnd || velocity[1] > 0.4 || (gull.presence > 0 && gull.presence < 1);
    gull.flap += ((flapping ? 1 : 0) - gull.flap) * Math.min(dt / 0.25, 1);
    gull.flapPhase = (gull.flapPhase + 2 * Math.PI * FLAP_FREQUENCY * dt) % (2 * Math.PI);
  }
}

function approach(value, target, step) {
  return value < target ? Math.min(value + step, target) : Math.max(value - step, target);
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// 海鷗的模型（公尺）：前方 +z、上方 +y、左翼在 +x；翼展約 1.3 公尺，翅膀在腕部彎折，像海鷗的 M 字形
// 每個頂點：位置、法線、正面顏色、背面顏色、部位（0 身體、1 內側翅膀、2 外側翅膀）
const WHITE = [0.86, 0.86, 0.84];
const GREY = [0.55, 0.58, 0.62];
const BLACK = [0.05, 0.05, 0.06];
const YELLOW = [0.75, 0.6, 0.12];
export const GULL_FLOATS = 13;

export function buildGullGeometry() {
  const data = [];
  const triangle = (a, b, c, { color, back = color, part = 0, normal = null }) => {
    const n = normal ?? faceNormal(a, b, c);
    for (const p of [a, b, c]) data.push(...p, ...n, ...color, ...back, part);
  };

  // 身體：從鳥喙到尾巴的兩圈剖面
  const nose = [0, 0.005, 0.24];
  const ring1 = [[0, 0.045, 0.03], [0.05, 0, 0.03], [0, -0.04, 0.03], [-0.05, 0, 0.03]];
  const ring2 = [[0, 0.03, -0.12], [0.035, 0.005, -0.12], [0, -0.02, -0.12], [-0.035, 0.005, -0.12]];
  const tail = [0, 0.012, -0.22];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    triangle(nose, ring1[j], ring1[i], { color: WHITE });
    triangle(ring1[i], ring1[j], ring2[j], { color: i === 0 || j === 0 ? GREY : WHITE });
    triangle(ring1[i], ring2[j], ring2[i], { color: i === 0 || j === 0 ? GREY : WHITE });
    triangle(ring2[i], ring2[j], tail, { color: WHITE });
  }
  // 尾羽與鳥喙
  triangle([0, 0.012, -0.14], [0.07, 0.01, -0.27], [-0.07, 0.01, -0.27], { color: WHITE, normal: [0, 1, 0] });
  triangle([0, 0.012, 0.22], [0.012, 0.0, 0.2], [0, 0.0, 0.3], { color: YELLOW });
  triangle([0, 0.012, 0.22], [0, 0.0, 0.3], [-0.012, 0.0, 0.2], { color: YELLOW });

  // 翅膀：內側（肩到腕）與外側（腕到翼尖，末端是黑色的翼尖）；上面灰、下面白
  for (const side of [1, -1]) {
    const p = (x, z) => [x * side, 0.01, z];
    const up = { normal: [0, 1, 0] };
    triangle(p(0.04, 0.07), p(0.3, 0.08), p(0.04, -0.1), { ...up, color: GREY, back: WHITE, part: 1 });
    triangle(p(0.04, -0.1), p(0.3, 0.08), p(0.3, -0.08), { ...up, color: GREY, back: WHITE, part: 1 });
    triangle(p(0.3, 0.08), p(0.5, 0.0), p(0.3, -0.08), { ...up, color: GREY, back: WHITE, part: 2 });
    triangle(p(0.3, -0.08), p(0.5, 0.0), p(0.48, -0.09), { ...up, color: GREY, back: WHITE, part: 2 });
    triangle(p(0.5, 0.0), p(0.66, -0.07), p(0.48, -0.09), { ...up, color: BLACK, back: BLACK, part: 2 });
  }
  return new Float32Array(data);
}

function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...n) || 1;
  return n.map((x) => x / length);
}

// 繪製：每隻海鷗是一個 instance，(x, y, z, 航向) 與 (俯仰, 側傾, 拍翅相位, 拍翅幅度)
export class Gulls {
  constructor(gl, program, options) {
    this.gl = gl;
    this.program = program;
    this.flock = new GullFlock(options);
    const geometry = buildGullGeometry();
    this.vertexCount = geometry.length / GULL_FLOATS;
    this.instances = new Float32Array(this.flock.gulls.length * 8);
    this.instanceCount = 0;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
    const stride = GULL_FLOATS * 4;
    [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 3, 36], [4, 1, 48]].forEach(([location, size, offset]) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    });
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
    for (const location of [5, 6]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 32, (location - 5) * 16);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  update(deltaTime, conditions) {
    const calls = this.flock.update(deltaTime, conditions);
    const visible = this.flock.visible;
    visible.forEach((gull, i) => this.instances.set([
      ...gull.position, gull.yaw, gull.pitch, gull.roll, gull.flapPhase, gull.flap,
    ], i * 8));
    this.instanceCount = visible.length;
    return calls;
  }

  draw({ camera, sky, environment }) {
    if (!this.instanceCount) return;
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instances, 0, this.instanceCount * 8);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const program = this.program.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_camPos', camera.position)
      .tex('u_sky', sky.texture, 0);
    setEnvironmentUniforms(program, environment);
    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertexCount, this.instanceCount);
    gl.bindVertexArray(null);
  }
}
