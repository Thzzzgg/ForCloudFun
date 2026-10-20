// 視角控制與攝影機的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraRig, ORBIT_LIMITS, BOAT_LIMITS, orbitPosition } from '../js/camera-rig.js';
import { createCamera, updateCamera, horizonNdcTop } from '../js/camera.js';

const DEG = Math.PI / 180;
const TARGET = [-6, 1, -24];
const ORBIT = { yaw: 7 * DEG, elevation: 8 * DEG, distance: 28, fovY: 50 * DEG };

function createRig() {
  const [x, , z] = orbitPosition(TARGET, ORBIT);
  return new CameraRig({ target: TARGET, orbit: ORBIT, boat: { x, z, yaw: ORBIT.yaw, pitch: -4 * DEG, fovY: 55 * DEG } });
}

// 以 60 fps 推進一段時間，回傳最後的姿態
function run(rig, seconds, significantHeight = 2) {
  let pose = rig.pose;
  for (let t = 0; t < seconds; t += 1 / 60) pose = rig.update(1 / 60, significantHeight);
  return pose;
}

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}：${actual} 與預期 ${expected} 相差超過 ${tolerance}`);
};

const probe = (displacement, slope = [0, 0]) => ({ displacement, slope });

test('預設的環繞視角從預設位置看向浮標', () => {
  const rig = createRig();
  const pose = run(rig, 1);
  const expected = orbitPosition(TARGET, ORBIT);
  pose.position.forEach((v, i) => close(v, expected[i], 1e-6, `位置 ${i}`));
  close(pose.yaw, ORBIT.yaw, 1e-6, 'yaw');
  close(pose.pitch, -ORBIT.elevation, 1e-6, 'pitch');
});

test('環繞模式拖曳時鏡頭繞著浮標轉，視線一直對準浮標', () => {
  const rig = createRig();
  rig.rotate(400, 0, 800); // 拖曳半個畫面高 = 轉 90°
  const pose = run(rig, 2);
  close(pose.yaw, ORBIT.yaw + Math.PI / 2, 1e-3, 'yaw');
  const toTarget = TARGET.map((v, i) => v - pose.position[i]);
  close(Math.hypot(...toTarget), ORBIT.distance, 1e-3, '與浮標的距離');
});

test('環繞模式的仰角與距離都有上下限', () => {
  const rig = createRig();
  rig.rotate(0, 100000, 800);
  rig.zoom(1000);
  assert.equal(rig.goal.orbit.elevation, ORBIT_LIMITS.maxElevation);
  assert.equal(rig.goal.orbit.distance, ORBIT_LIMITS.maxDistance);
  rig.rotate(0, -100000, 800);
  rig.zoom(1e-6);
  assert.equal(rig.goal.orbit.elevation, ORBIT_LIMITS.minElevation);
  assert.equal(rig.goal.orbit.distance, ORBIT_LIMITS.minDistance);
});

test('鏡頭壓低時不會沒入海面，海面升高時會跟著抬高', () => {
  const rig = createRig();
  rig.rotate(0, -100000, 800); // 仰角壓到最低
  rig.setProbes(probe([0, 3, 0]), null); // 鏡頭下方剛好是 3 公尺高的浪峰
  const pose = run(rig, 3, 2);
  assert.ok(pose.position[1] >= 3 + 1 + 0.5 * 2 - 0.05, `鏡頭高度 ${pose.position[1]} 太低`);
});

test('船上視角：船跟著海面位移起伏，甲板高度隨浪高增加', () => {
  const rig = createRig();
  rig.setMode('boat');
  rig.setProbes(null, probe([0.5, 1.2, -0.3]));
  const pose = run(rig, 4, 2);
  const { x, z } = rig.current.boat;
  close(pose.position[0], x + 0.5, 1e-3, 'x');
  close(pose.position[1], 1.2 + 2 + 0.6 * 2, 1e-3, '高度');
  close(pose.position[2], z - 0.3, 1e-3, 'z');
});

test('船上視角：海面往右下傾時鏡頭往右傾，往前下傾時視線往下', () => {
  const rig = createRig();
  rig.setMode('boat');
  rig.goal.boat.yaw = 0; // 面向 -Z，右方是 +X
  rig.goal.boat.pitch = 0;
  // 高度往 +X 降低（∂h/∂x < 0）：法線偏右，船往右舷傾
  rig.setProbes(null, probe([0, 0, 0], [-0.2, 0]));
  let pose = run(rig, 4);
  close(pose.roll, -0.6 * Math.atan(0.2), 1e-3, 'roll');
  close(pose.pitch, 0, 1e-3, 'pitch');
  // 高度往 -Z（前方）降低（∂h/∂z > 0）：船頭朝下
  rig.setProbes(null, probe([0, 0, 0], [0, 0.2]));
  pose = run(rig, 4);
  close(pose.pitch, -0.6 * Math.atan(0.2), 1e-3, 'pitch');
  close(pose.roll, 0, 1e-3, 'roll');
});

test('船上視角的傾斜角度有上限', () => {
  const rig = createRig();
  rig.setMode('boat');
  rig.setProbes(null, probe([0, 0, 0], [-5, 5]));
  const pose = run(rig, 4);
  assert.ok(Math.abs(pose.roll) <= 15 * DEG + 1e-9);
});

test('船上視角的視野縮放與俯仰有上下限', () => {
  const rig = createRig();
  rig.setMode('boat');
  rig.zoom(100);
  assert.equal(rig.goal.boat.fovY, BOAT_LIMITS.maxFov);
  rig.zoom(0.0001);
  assert.equal(rig.goal.boat.fovY, BOAT_LIMITS.minFov);
  rig.rotate(0, -100000, 800);
  assert.equal(rig.goal.boat.pitch, BOAT_LIMITS.minPitch);
});

test('切換模式時鏡頭平順移動，並沿用目前的視線方向', () => {
  const rig = createRig();
  rig.rotate(200, 0, 800);
  const before = run(rig, 2);
  rig.setMode('boat');
  close(rig.goal.boat.yaw, before.yaw, 1e-9, '上船後的視線方向');
  const first = rig.update(1 / 60, 2);
  // 過渡的第一幀還很接近原本的位置
  assert.ok(Math.hypot(...first.position.map((v, i) => v - before.position[i])) < 1);
  const settled = run(rig, 2);
  assert.equal(rig.transition, null);
  close(settled.yaw, before.yaw, 1e-3, '過渡結束後的視線方向');
});

test('鍵盤轉動：正值往右看、往上看', () => {
  const rig = createRig();
  const start = run(rig, 1);
  rig.turn(10 * DEG, 0);
  close(run(rig, 2).yaw - start.yaw, 10 * DEG, 1e-3, '環繞模式往右');
  rig.setMode('boat');
  run(rig, 2);
  const boatStart = rig.pose;
  rig.turn(0, 5 * DEG);
  assert.ok(run(rig, 2).pitch > boatStart.pitch, '船上往上看');
});

test('重設視角回到預設值；全部重設也會切回環繞模式', () => {
  const rig = createRig();
  rig.rotate(300, 200, 800);
  rig.zoom(3);
  rig.reset();
  const pose = run(rig, 3);
  close(pose.yaw, ORBIT.yaw, 1e-3, 'yaw');
  close(pose.pitch, -ORBIT.elevation, 1e-3, 'pitch');
  rig.setMode('boat');
  rig.resetAll();
  assert.equal(rig.mode, 'orbit');
});

test('需要取樣的位置是鏡頭正下方與船的位置', () => {
  const rig = createRig();
  const pose = run(rig, 1);
  const [camera, boat] = rig.probePoints();
  close(camera.x, pose.position[0], 1e-9, '鏡頭 x');
  close(camera.z, pose.position[2], 1e-9, '鏡頭 z');
  close(boat.x, rig.current.boat.x, 1e-9, '船 x');
});

test('地平線位置公式與實際投影一致（含俯仰與傾斜）', () => {
  const extent = 1.5;
  for (const [pitch, roll] of [[-7, 0], [-30, 0], [10, 0], [-7, 8], [-12, -10], [5, 12]]) {
    const camera = createCamera({ fovY: 50 * DEG });
    Object.assign(camera, { position: [0, 5, 0], yaw: 0.3, pitch: pitch * DEG, roll: roll * DEG });
    updateCamera(camera, 16 / 9);
    // 投影兩個極遠處的地平線點，連成直線後求 x = ±extent 時的 y
    const project = (azimuth) => {
      const d = [Math.sin(camera.yaw + azimuth), 0, -Math.cos(camera.yaw + azimuth)];
      const p = d.map((v, i) => camera.position[i] + v * 1e7);
      const m = camera.viewProjection;
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      return [(m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w, (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w];
    };
    const [a, b] = [project(-0.2), project(0.2)];
    const slope = (b[1] - a[1]) / (b[0] - a[0]);
    const highest = Math.max(a[1] + slope * (-extent - a[0]), a[1] + slope * (extent - a[0]));
    close(horizonNdcTop(camera, extent), highest, 2e-3, `pitch ${pitch}° roll ${roll}°`);
  }
});
