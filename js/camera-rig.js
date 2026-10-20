// 視角控制的核心邏輯（不碰 DOM 與 WebGL，可以在 Node 中測試，見 tests/camera-rig.test.mjs）
// 環繞浮標：拖曳環繞、縮放距離；船上視角：鏡頭架在隨浪起伏的船上，可以環顧與縮放視野
// 角度單位為弧度；yaw 為 0 時面向 -Z（畫面遠方），往右為正

const DEG = Math.PI / 180;
const SMOOTHING = 0.12; // 拖曳與縮放的平滑時間常數（秒）
const TRANSITION_SECONDS = 0.8; // 切換模式時鏡頭移動的時間
const BOAT_TILT = 0.6; // 甲板傾斜傳到視線的比例（人會本能地穩住頭部）
const MAX_TILT = 15 * DEG;

export const ORBIT_LIMITS = { minDistance: 6, maxDistance: 300, minElevation: 1 * DEG, maxElevation: 80 * DEG };
export const BOAT_LIMITS = { minPitch: -60 * DEG, maxPitch: 45 * DEG, minFov: 20 * DEG, maxFov: 75 * DEG };

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// 指數平滑：每幀往目標靠近一些，結果與幀率無關
const follow = (current, target, dt, tau) => current + (target - current) * (1 - Math.exp(-dt / tau));
const followAngle = (current, target, dt, tau) => current + wrapAngle(target - current) * (1 - Math.exp(-dt / tau));

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 環繞模式下的鏡頭位置：從中心往視線反方向退 distance，再依仰角抬高
export function orbitPosition(target, { yaw, elevation, distance }) {
  const horizontal = distance * Math.cos(elevation);
  return [
    target[0] - Math.sin(yaw) * horizontal,
    target[1] + distance * Math.sin(elevation),
    target[2] + Math.cos(yaw) * horizontal,
  ];
}

export class CameraRig {
  // target：環繞中心 [x, y, z]
  // orbit：{ yaw, elevation, distance, fovY }；boat：{ x, z, yaw, pitch, fovY }（x、z 為船的位置）
  constructor({ target, orbit, boat }) {
    this.target = target;
    this.defaults = { orbit: { ...orbit }, boat: { ...boat } };
    this.goal = { orbit: { ...orbit }, boat: { ...boat } }; // 使用者操作後想去的地方
    this.current = { orbit: { ...orbit }, boat: { ...boat } }; // 平滑後實際使用的值
    this.mode = 'orbit';
    this.probes = { camera: null, boat: null };
    this.waterLevel = null;
    this.boatPosition = null;
    this.tilt = { pitch: 0, roll: 0 };
    this.transition = null;
    this.pose = { position: orbitPosition(target, orbit), yaw: orbit.yaw, pitch: -orbit.elevation, roll: 0, fovY: orbit.fovY };
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'boat') {
      // 上船時面向目前的視線方向，畫面比較連貫
      for (const state of [this.goal.boat, this.current.boat]) {
        state.yaw = this.pose.yaw;
        state.pitch = clamp(this.pose.pitch, BOAT_LIMITS.minPitch, BOAT_LIMITS.maxPitch);
      }
      this.boatPosition = null;
    }
    this.transition = { from: { ...this.pose, position: [...this.pose.position] }, elapsed: 0 };
    this.mode = mode;
  }

  // 拖曳：手指底下的東西跟著手指走（環繞時轉動浮標，船上時轉動整個世界）
  rotate(dx, dy, viewportHeight) {
    const h = Math.max(viewportHeight, 1);
    if (this.mode === 'orbit') {
      const goal = this.goal.orbit;
      goal.yaw = wrapAngle(goal.yaw + (dx / h) * Math.PI);
      goal.elevation = clamp(goal.elevation + (dy / h) * Math.PI, ORBIT_LIMITS.minElevation, ORBIT_LIMITS.maxElevation);
    } else {
      const goal = this.goal.boat;
      goal.yaw = wrapAngle(goal.yaw - (dx / h) * goal.fovY);
      goal.pitch = clamp(goal.pitch + (dy / h) * goal.fovY, BOAT_LIMITS.minPitch, BOAT_LIMITS.maxPitch);
    }
  }

  // 鍵盤：直接轉動視線，正值代表往右看、往上看
  turn(dYaw, dPitch) {
    if (this.mode === 'orbit') {
      const goal = this.goal.orbit;
      goal.yaw = wrapAngle(goal.yaw + dYaw);
      goal.elevation = clamp(goal.elevation - dPitch, ORBIT_LIMITS.minElevation, ORBIT_LIMITS.maxElevation);
    } else {
      const goal = this.goal.boat;
      goal.yaw = wrapAngle(goal.yaw + dYaw);
      goal.pitch = clamp(goal.pitch + dPitch, BOAT_LIMITS.minPitch, BOAT_LIMITS.maxPitch);
    }
  }

  // factor > 1 拉遠（環繞時距離變大，船上時視野變寬）
  zoom(factor) {
    if (this.mode === 'orbit') {
      const goal = this.goal.orbit;
      goal.distance = clamp(goal.distance * factor, ORBIT_LIMITS.minDistance, ORBIT_LIMITS.maxDistance);
    } else {
      const goal = this.goal.boat;
      goal.fovY = clamp(goal.fovY * factor, BOAT_LIMITS.minFov, BOAT_LIMITS.maxFov);
    }
  }

  // 目前模式回到預設視角
  reset() {
    this.goal[this.mode] = { ...this.defaults[this.mode] };
  }

  // 兩種模式都回到預設，並切回環繞模式
  resetAll() {
    this.goal = { orbit: { ...this.defaults.orbit }, boat: { ...this.defaults.boat } };
    this.setMode('orbit');
  }

  // 從 GPU 讀回的海面資料 { displacement, slope }：camera 是鏡頭正下方，boat 是船的位置；尚未讀回時為 null
  setProbes(camera, boat) {
    this.probes.camera = camera;
    this.probes.boat = boat;
  }

  // 需要在 GPU 上取樣的位置，順序對應 setProbes 的參數
  probePoints() {
    const boat = this.current.boat;
    return [
      { x: this.pose.position[0], z: this.pose.position[2], footprint: 4 },
      { x: boat.x, z: boat.z, footprint: 10 },
    ];
  }

  update(dt, significantHeight) {
    let pose = this.mode === 'orbit' ? this.updateOrbit(dt, significantHeight) : this.updateBoat(dt, significantHeight);
    if (this.transition) {
      this.transition.elapsed += dt;
      const t = Math.min(this.transition.elapsed / TRANSITION_SECONDS, 1);
      const s = t * t * (3 - 2 * t);
      const from = this.transition.from;
      pose = {
        position: from.position.map((v, i) => v + (pose.position[i] - v) * s),
        yaw: from.yaw + wrapAngle(pose.yaw - from.yaw) * s,
        pitch: from.pitch + (pose.pitch - from.pitch) * s,
        roll: from.roll + (pose.roll - from.roll) * s,
        fovY: from.fovY + (pose.fovY - from.fovY) * s,
      };
      if (t >= 1) this.transition = null;
    }
    this.pose = pose;
    return pose;
  }

  updateOrbit(dt, significantHeight) {
    const goal = this.goal.orbit;
    const state = this.current.orbit;
    state.yaw = followAngle(state.yaw, goal.yaw, dt, SMOOTHING);
    state.elevation = follow(state.elevation, goal.elevation, dt, SMOOTHING);
    state.distance = Math.exp(follow(Math.log(state.distance), Math.log(goal.distance), dt, SMOOTHING));
    state.fovY = goal.fovY;
    const position = orbitPosition(this.target, state);

    // 鏡頭不能低於海面：讀回的海面升高時很快跟上，降低時慢慢放下，避免上下抖動
    // 還沒讀回時，用有效波高估計浪峰高度
    const water = this.probes.camera ? this.probes.camera.displacement[1] : 0.6 * significantHeight;
    if (this.waterLevel === null) this.waterLevel = water;
    else this.waterLevel = follow(this.waterLevel, water, dt, water > this.waterLevel ? 0.15 : 1.5);
    position[1] = Math.max(position[1], this.waterLevel + 1 + 0.5 * significantHeight);

    const forward = normalize(this.target.map((v, i) => v - position[i]));
    return { position, yaw: Math.atan2(forward[0], -forward[2]), pitch: Math.asin(forward[1]), roll: 0, fovY: state.fovY };
  }

  updateBoat(dt, significantHeight) {
    const goal = this.goal.boat;
    const state = this.current.boat;
    state.yaw = followAngle(state.yaw, goal.yaw, dt, SMOOTHING);
    state.pitch = follow(state.pitch, goal.pitch, dt, SMOOTHING);
    state.fovY = follow(state.fovY, goal.fovY, dt, SMOOTHING);
    state.x = goal.x;
    state.z = goal.z;

    // 船跟著水粒子做軌道運動：靜止位置加上海面位移，再加上甲板高度（浪大時用大一點的船）
    const probe = this.probes.boat;
    const d = probe ? probe.displacement : [0, 0, 0];
    const target = [state.x + d[0], d[1] + 2 + 0.6 * significantHeight, state.z + d[2]];
    this.boatPosition = this.boatPosition
      ? this.boatPosition.map((v, i) => follow(v, target[i], dt, 0.25))
      : target;

    // 甲板傾斜：海面法線偏向視線前方時船頭朝下，鏡頭跟著往下；偏向右方時船往右舷傾，鏡頭跟著往右傾
    const slope = probe ? probe.slope : [0, 0];
    const normal = normalize([-slope[0], 1, -slope[1]]);
    const forward = [Math.sin(state.yaw), 0, -Math.cos(state.yaw)];
    const right = [Math.cos(state.yaw), 0, Math.sin(state.yaw)];
    const pitchTilt = clamp(-BOAT_TILT * Math.atan2(dot(normal, forward), normal[1]), -MAX_TILT, MAX_TILT);
    const rollTilt = clamp(-BOAT_TILT * Math.atan2(dot(normal, right), normal[1]), -MAX_TILT, MAX_TILT);
    this.tilt.pitch = follow(this.tilt.pitch, pitchTilt, dt, 0.3);
    this.tilt.roll = follow(this.tilt.roll, rollTilt, dt, 0.3);

    return {
      position: [...this.boatPosition],
      yaw: state.yaw,
      pitch: clamp(state.pitch + this.tilt.pitch, -85 * DEG, 85 * DEG),
      roll: this.tilt.roll,
      fovY: state.fovY,
    };
  }
}
