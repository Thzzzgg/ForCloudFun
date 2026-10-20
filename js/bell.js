// 鐘浮標的鐘錘：浮標隨浪搖晃時，吊在鐘裡的鐘錘因為慣性擺盪，撞到鐘的內緣就會響
// 以小角度的單擺模擬鐘錘在水平面上的位移，支點跟著浮標頂端移動；不依賴 WebGL 與 Web Audio
// 浮標的模型：
// - 慣性：真實的鐘浮標又大又重，短浪幾乎推不動它，取樣到的漂移與海面坡度先經過三段低通濾波
// - 搖擺：浮標像不倒翁，有自己的搖擺週期；被（濾波後的）海面坡度帶動，週期接近的長浪會讓它越搖越大，
//   平靜海面上短而碎的浪則搖不起來，所以浪大時鐘聲又多又響、平靜時幾乎不響
// 濾波、搖擺與鐘錘都在取樣的時間軸上積分：兩次取樣之間的姿態線性內插，加速度直接由狀態算出、
// 不對取樣做差分，所以不論幀率高低、讀回晚幾幀或漏掉幾筆，鐘響的頻率都差不多

const GRAVITY = 9.81;
const MAX_STEP = 1 / 240; // 每一小步最長的時間（秒），撞擊才不會穿過鐘壁
const MIN_STRIKE_SPEED = 0.02; // 撞擊速度低於這個值（m/s）只是輕輕碰到，聽不到
const FULL_STRIKE_SPEED = 0.22; // 撞擊速度達到這個值（m/s）就用最大的力道敲響（大浪時偶爾出現）
const RELEASE = 0.8; // 鐘錘離開鐘壁超過間隙的 20% 才算分開，之後再撞上才是新的一響
const MAX_SAMPLE_GAP = 1; // 取樣中斷超過這麼久（動畫時間，秒）就從靜止重新開始

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];

// 撞擊速度（m/s）換算成 0～1 的敲擊力道
export function strikeStrength(speed) {
  return Math.min(Math.max((speed - MIN_STRIKE_SPEED) / (FULL_STRIKE_SPEED - MIN_STRIKE_SPEED), 0), 1);
}

export class BellClapper {
  // pivotHeight：鐘錘支點在吃水線上多高（公尺）；length：鐘錘的擺長；gap：鐘錘靜止時與鐘內緣的距離
  // inertia：浮標慣性的時間常數（秒，須大於 0），每段低通都用這個值
  // rockPeriod：浮標自己搖擺的週期（秒）；rockDamping：搖擺的阻尼比
  constructor({
    pivotHeight = 2.1, length = 0.3, gap = 0.05, damping = 0.3, restitution = 0.3,
    inertia = 0.35, rockPeriod = 4, rockDamping = 0.25,
  } = {}) {
    Object.assign(this, { pivotHeight, length, gap, damping, restitution, inertia, rockPeriod, rockDamping });
    this.last = null; // 上一次的取樣：{ time, center, tilt }
    this.buoy = null; // 浮標的狀態：漂移與坡度的三段濾波、搖擺的傾斜與傾斜變化率
    this.ignoreBefore = -Infinity; // 比這個時間早的取樣屬於換海況之前的海面
    this.offset = [0, 0]; // 鐘錘相對支點的水平位移（公尺）
    this.velocity = [0, 0];
    this.touching = false; // 鐘錘正貼著鐘壁（被傾斜的鐘推著走）時不會一直響
  }

  // 浮標搖擺的傾斜：上方向的水平分量除以垂直分量
  get tilt() {
    return this.buoy ? [...this.buoy.angle] : [0, 0];
  }

  // 有新的浮標姿態時呼叫：center 為吃水線的中心 [x, y, z]，up 為浮標的上方向（單位向量），
  // time 為這份姿態實際取樣的動畫時間（秒）；回傳從上一次取樣到這一次之間，鐘錘撞擊的速度（m/s）
  addSample({ center, up }, time) {
    const last = this.last;
    if (time < this.ignoreBefore || (last && time <= last.time)) return [];
    const sample = { time, center: [center[0], center[2]], tilt: [up[0] / up[1], up[2] / up[1]] };
    this.last = sample;
    if (!this.buoy || time - last.time > MAX_SAMPLE_GAP) {
      // 從靜止開始：濾波器的輸出就是目前的姿態
      const stages = (value) => [[...value], [...value], [...value]];
      this.buoy = { center: stages(sample.center), tilt: stages(sample.tilt), angle: [...sample.tilt], rate: [0, 0] };
      return [];
    }
    return this.advance(last, sample);
  }

  // 海況突然改變時呼叫，time 為改變的動畫時間：之前送出、還沒讀回的取樣屬於舊的海面，直接略過；
  // 浮標從新海面的第一筆取樣重新開始，避免把海面的跳動當成劇烈搖晃
  resetMotion(time = -Infinity) {
    this.last = null;
    this.buoy = null;
    this.ignoreBefore = time;
  }

  // 從上一次取樣積分到這一次，回傳撞擊速度
  advance(from, to) {
    const strikes = [];
    const span = to.time - from.time;
    const steps = Math.ceil(span / MAX_STEP);
    const dt = span / steps;
    const tau = this.inertia;
    const blend = 1 - Math.exp(-dt / tau); // 一階低通在一小步內追上輸入的比例
    const rockOmega = (2 * Math.PI) / this.rockPeriod;
    const omega2 = GRAVITY / this.length;
    const { center, tilt, angle, rate } = this.buoy;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      for (let k = 0; k < 2; k++) {
        // 三段低通濾波後漂移的加速度 = (第一段 − 2 × 第二段 + 第三段) / τ²
        const driftAcceleration = (center[0][k] - 2 * center[1][k] + center[2][k]) / (tau * tau);
        let centerInput = from.center[k] + (to.center[k] - from.center[k]) * f;
        let tiltInput = from.tilt[k] + (to.tilt[k] - from.tilt[k]) * f;
        for (let stage = 0; stage < 3; stage++) {
          center[stage][k] += (centerInput - center[stage][k]) * blend;
          tilt[stage][k] += (tiltInput - tilt[stage][k]) * blend;
          centerInput = center[stage][k];
          tiltInput = tilt[stage][k];
        }
        // 浮標的搖擺：被濾波後的坡度拉向海面的傾斜，同時受阻尼
        const angularAcceleration = rockOmega * rockOmega * (tiltInput - angle[k]) - 2 * this.rockDamping * rockOmega * rate[k];
        rate[k] += angularAcceleration * dt;
        angle[k] += rate[k] * dt;
        // 在跟著支點加速的座標系裡：重力把鐘錘拉回正下方，支點的加速度則像一股反方向的力
        const pivotAcceleration = driftAcceleration + this.pivotHeight * angularAcceleration;
        const acceleration = -omega2 * this.offset[k] - pivotAcceleration - this.damping * this.velocity[k];
        this.velocity[k] += acceleration * dt;
        this.offset[k] += this.velocity[k] * dt;
      }
      // 鐘跟著浮標傾斜：鐘錘高度處的鐘壁中心偏移 -傾斜 × 擺長
      const speed = this.collide(scale(angle, -this.length), scale(rate, -this.length));
      if (speed >= MIN_STRIKE_SPEED) strikes.push(speed);
    }
    return strikes;
  }

  // 鐘錘超出鐘壁時反彈；回傳新的一響的撞擊速度，沒有響則回傳 0
  collide(wallCenter, wallVelocity) {
    const relative = sub(this.offset, wallCenter);
    const distance = Math.hypot(relative[0], relative[1]);
    if (distance <= this.gap) {
      if (distance < this.gap * RELEASE) this.touching = false;
      return 0;
    }
    const normal = scale(relative, 1 / distance);
    const relativeVelocity = sub(this.velocity, wallVelocity);
    const speed = relativeVelocity[0] * normal[0] + relativeVelocity[1] * normal[1];
    const wasTouching = this.touching;
    this.touching = true;
    this.offset = [wallCenter[0] + normal[0] * this.gap, wallCenter[1] + normal[1] * this.gap];
    if (speed <= 0) return 0;
    // 撞擊：法線方向的相對速度反彈並損失能量
    this.velocity = sub(this.velocity, scale(normal, (1 + this.restitution) * speed));
    return wasTouching ? 0 : speed;
  }
}
