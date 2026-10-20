// 大氣穿透率與光源計算的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { transmittance, skyLighting } from '../js/sky.js';
import { sunDirection, moonDirection } from '../js/celestial.js';

const DEG = Math.PI / 180;
const direction = (elevationDeg) => [0, Math.sin(elevationDeg * DEG), -Math.cos(elevationDeg * DEG)];
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test('天頂方向的穿透率高，紅光比藍光容易穿透', () => {
  const [r, g, b] = transmittance(direction(90));
  assert.ok(r > 0.85 && r < 1, `紅光 ${r}`);
  assert.ok(r > g && g > b, `紅綠藍依序遞減：${r}, ${g}, ${b}`);
});

test('越接近地平線穿透率越低、越偏紅；落到地平線下就被地球擋住', () => {
  const high = transmittance(direction(30));
  const low = transmittance(direction(3));
  assert.ok(luminance(low) < luminance(high));
  assert.ok(low[0] / low[2] > high[0] / high[2], '低角度時紅藍比較大');
  assert.deepEqual(transmittance(direction(-2)), [0, 0, 0]);
});

test('站在雲層高度時地平線比較低，日落後仍照得到太陽', () => {
  const belowHorizon = direction(-0.8);
  assert.deepEqual(transmittance(belowHorizon), [0, 0, 0]);
  assert.ok(luminance(transmittance(belowHorizon, 1.5)) > 0);
});

test('下午 4 點只有陽光，晚上 11 點只有月光', () => {
  const afternoon = skyLighting(sunDirection(16), moonDirection(16));
  assert.ok(luminance(afternoon.lightColors.slice(0, 3)) > 10, '太陽');
  assert.equal(luminance(afternoon.lightColors.slice(3)), 0, '白天略過月光');
  const night = skyLighting(sunDirection(23), moonDirection(23));
  assert.equal(luminance(night.lightColors.slice(0, 3)), 0, '太陽在地平線下');
  assert.ok(luminance(night.lightColors.slice(3)) > 0, '月光');
});

test('照亮雲的光源方向是單位向量，日落時介於太陽與月亮之間', () => {
  for (const hours of [12, 18.03, 21]) {
    const { cloudLightDir } = skyLighting(sunDirection(hours), moonDirection(hours));
    assert.ok(Math.abs(Math.hypot(...cloudLightDir) - 1) < 1e-9, `${hours} 時`);
  }
  // 日落後幾分鐘，雲層高度還看得到太陽，但比月光暗得多或差不多，方向會偏離太陽
  const sun = sunDirection(18.07);
  const { cloudLightDir } = skyLighting(sun, moonDirection(18.07));
  const towardSun = cloudLightDir.reduce((sum, v, i) => sum + v * sun[i], 0);
  assert.ok(towardSun < 0.999, '方向不完全等於太陽');
});

test('霧越濃，照到海面的光越弱', () => {
  const sun = sunDirection(16);
  const moon = moonDirection(16);
  const clear = luminance(skyLighting(sun, moon, 0).lightColors.slice(0, 3));
  const hazy = luminance(skyLighting(sun, moon, 1).lightColors.slice(0, 3));
  assert.ok(hazy < clear * 0.2, `晴天 ${clear}、起霧 ${hazy}`);
});
