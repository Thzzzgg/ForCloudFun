// 鐘浮標的鐘錘：浮標隨浪搖晃時，吊在鐘裡的鐘錘因為慣性擺盪，撞到鐘的內緣就會響
// 以小角度的單擺模擬鐘錘在水平面上的位移，支點跟著浮標頂端移動；不依賴 WebGL 與 Web Audio

const GRAVITY = 9.81;
const MAX_STEP = 1 / 240; // 每一小步最長的時間（秒），撞擊才不會穿過鐘壁
const MIN_STRIKE_SPEED = 0.02; // 撞擊速度低於這個值（m/s）只是輕輕碰到，聽不到
const RELEASE = 0.8; // 鐘錘離開鐘壁超過間隙的 20% 才算分開，之後再撞上才是新的一響
const MAX_SAMPLE_GAP = 0.5; // 取樣間隔超過這麼久（例如分頁切到背景）就重新開始估計速度

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];

export class BellClapper {
  // pivotHeight：鐘錘支點在吃水線上多高（公尺）；length：鐘錘的擺長；gap：鐘錘靜止時與鐘內緣的距離
  constructor({ pivotHeight = 2.1, length = 0.3, gap = 0.05, damping = 0.5, restitution = 0.3 } = {}) {
    Object.assign(this, { pivotHeight, length, gap, damping, restitution });
    this.offset = [0, 0]; // 鐘錘相對支點的水平位移（公尺）
    this.velocity = [0, 0];
    this.tilt = [0, 0]; // 浮標的傾斜：上方向的水平分量除以垂直分量
    this.tiltRate = [0, 0];
    this.pivotAcceleration = [0, 0];
    this.samples = []; // 最近三次取樣：{ time, pivot, tilt }
    this.clock = 0;
    this.touching = false; // 鐘錘正貼著鐘壁（被傾斜的鐘推著走）時不會一直響
  }

  // 有新的浮標姿態時呼叫：center 為吃水線的中心 [x, y, z]，up 為浮標的上方向（單位向量）
  // time 為這份姿態實際取樣的時間（秒）：讀回的資料會晚幾幀、不一定每幀都有，
  // 用到達的時間差分會算出假的加速度尖峰，把鐘錘踢響
  addSample({ center, up }, time) {
    const tilt = [up[0] / up[1], up[2] / up[1]];
    const pivot = [center[0] + up[0] * this.pivotHeight, center[2] + up[2] * this.pivotHeight];
    const last = this.samples[this.samples.length - 1];
    if (last && time <= last.time) return;
    if (last && time - last.time > MAX_SAMPLE_GAP) this.samples = [];
    this.samples.push({ time, pivot, tilt });
    if (this.samples.length > 3) this.samples.shift();
    this.tilt = tilt;

    // 以最近三次取樣的差分估計速度與加速度（取樣時間不一定均勻）
    if (this.samples.length >= 2) {
      const [b, c] = this.samples.slice(-2);
      const dt = Math.max(c.time - b.time, 1e-3);
      this.tiltRate = scale(sub(c.tilt, b.tilt), 1 / dt);
      if (this.samples.length === 3) {
        const a = this.samples[0];
        const dt0 = Math.max(b.time - a.time, 1e-3);
        const v0 = scale(sub(b.pivot, a.pivot), 1 / dt0);
        const v1 = scale(sub(c.pivot, b.pivot), 1 / dt);
        this.pivotAcceleration = scale(sub(v1, v0), 2 / (dt0 + dt));
      }
    }
  }

  // 海況突然改變時呼叫：重新開始估計速度與加速度，避免把海面的跳動當成劇烈搖晃
  resetMotion() {
    this.samples = [];
    this.tiltRate = [0, 0];
    this.pivotAcceleration = [0, 0];
  }

  // 每幀呼叫，回傳這段時間內鐘錘撞擊的速度（m/s）
  update(deltaTime) {
    const strikes = [];
    const steps = Math.max(1, Math.ceil(deltaTime / MAX_STEP));
    const dt = deltaTime / steps;
    const omega2 = GRAVITY / this.length;
    for (let i = 0; i < steps; i++) {
      this.clock += dt;
      // 在跟著支點加速的座標系裡：重力把鐘錘拉回正下方，支點的加速度則像一股反方向的力
      for (let k = 0; k < 2; k++) {
        const acceleration = -omega2 * this.offset[k] - this.pivotAcceleration[k] - this.damping * this.velocity[k];
        this.velocity[k] += acceleration * dt;
        this.offset[k] += this.velocity[k] * dt;
      }
      // 鐘跟著浮標傾斜：鐘錘高度處的鐘壁中心偏移 -tilt × 擺長，以傾斜的速度移動
      const wallCenter = scale(this.tilt, -this.length);
      const wallVelocity = scale(this.tiltRate, -this.length);
      const relative = sub(this.offset, wallCenter);
      const distance = Math.hypot(relative[0], relative[1]);
      if (distance > this.gap) {
        const normal = scale(relative, 1 / distance);
        const relativeVelocity = sub(this.velocity, wallVelocity);
        const speed = relativeVelocity[0] * normal[0] + relativeVelocity[1] * normal[1];
        if (speed > 0) {
          // 撞擊：法線方向的相對速度反彈並損失能量
          this.velocity = sub(this.velocity, scale(normal, (1 + this.restitution) * speed));
          if (!this.touching && speed >= MIN_STRIKE_SPEED) strikes.push(speed);
        }
        this.touching = true;
        this.offset = [wallCenter[0] + normal[0] * this.gap, wallCenter[1] + normal[1] * this.gap];
      } else if (distance < this.gap * RELEASE) {
        this.touching = false;
      }
    }
    return strikes;
  }
}
