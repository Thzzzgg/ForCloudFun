// 太陽與月亮位置的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { sunDirection, moonDirection, sunHorizontal, skyRotation, periodName, formatTime } from '../js/celestial.js';

const DEG = Math.PI / 180;
const elevationOf = (d) => Math.asin(d[1]) / DEG;
const relativeAzimuthOf = (d) => Math.atan2(d[0], -d[2]) / DEG;

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}：${actual} 與預期 ${expected} 相差超過 ${tolerance}`);
};

test('春分時早上 6 點從正東方升起、晚上 6 點從正西方落下', () => {
  close(sunHorizontal(6).elevation, 0, 1e-9, '日出仰角');
  close(sunHorizontal(6).azimuth, 90, 1e-6, '日出方位');
  close(sunHorizontal(18).elevation, 0, 1e-9, '日落仰角');
  close(sunHorizontal(18).azimuth, 270, 1e-6, '日落方位');
});

test('北回歸線上春分正午的太陽在正南方，仰角 66.5°', () => {
  close(sunHorizontal(12).elevation, 66.5, 1e-9, '仰角');
  close(sunHorizontal(12).azimuth, 180, 1e-6, '方位');
});

test('預設的下午 4 點，太陽在畫面右前方 32°、仰角約 27°', () => {
  const sun = sunDirection(16);
  close(relativeAzimuthOf(sun), 32, 0.5, '相對方位');
  close(elevationOf(sun), 27.3, 0.1, '仰角');
  close(Math.hypot(...sun), 1, 1e-9, '單位向量');
});

test('上弦月傍晚 6 點最高，午夜落入西方海面', () => {
  close(elevationOf(moonDirection(18)), 66.5, 1e-6, '傍晚 6 點仰角');
  close(elevationOf(moonDirection(24)), 0, 1e-6, '午夜仰角');
  assert.ok(elevationOf(moonDirection(23)) > 10, '晚上 11 點還在海面上');
  assert.ok(Math.abs(relativeAzimuthOf(moonDirection(23))) < 45, '晚上 11 點在畫面前方');
});

// 行優先的 3×3 矩陣乘上向量
const rotate = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[3 + r] * y + m[6 + r] * z);
const rotateBack = (m, v) => [0, 1, 2].map((c) => m[c * 3] * v[0] + m[c * 3 + 1] * v[1] + m[c * 3 + 2] * v[2]);

test('天球旋轉矩陣和太陽、月亮的運行一致，北天極保持不動', () => {
  for (const [from, to] of [[0, 16], [16, 22.5], [7, 3]]) {
    const back = rotateBack(skyRotation(from), sunDirection(from));
    rotate(skyRotation(to), back).forEach((v, i) => close(v, sunDirection(to)[i], 1e-6, `太陽 ${from}→${to} 時`));
    const moon = rotate(skyRotation(to), rotateBack(skyRotation(from), moonDirection(from)));
    moon.forEach((v, i) => close(v, moonDirection(to)[i], 1e-6, `月亮 ${from}→${to} 時`));
  }
  const pole = [Math.SQRT1_2 * Math.cos(23.5 * DEG), Math.sin(23.5 * DEG), Math.SQRT1_2 * Math.cos(23.5 * DEG)];
  rotate(skyRotation(9), pole).forEach((v, i) => close(v, pole[i], 1e-9, '北天極'));
  close(Math.hypot(...rotate(skyRotation(5), [0.3, 0.4, -0.866])), Math.hypot(0.3, 0.4, -0.866), 1e-9, '長度不變');
});

test('時段名稱', () => {
  assert.equal(periodName(4), '夜晚');
  assert.equal(periodName(6), '清晨');
  assert.equal(periodName(9), '上午');
  assert.equal(periodName(12), '中午');
  assert.equal(periodName(16), '下午');
  assert.equal(periodName(18), '黃昏');
  assert.equal(periodName(21), '夜晚');
});

test('時間格式', () => {
  assert.equal(formatTime(16), '16:00');
  assert.equal(formatTime(6.25), '06:15');
  assert.equal(formatTime(23.999), '00:00');
  assert.equal(formatTime(24.5), '00:30');
});
