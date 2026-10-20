// 海浪頻譜的單元測試：湧浪的波高換算、方向分布正規化、各層波數分界
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { cascadeBoundaries, swellSpreadNormalization, waveStatistics, SWELL_SPREAD } from '../js/spectrum.js';

const CASCADES = [
  { length: 2000 },
  { length: 250, maxWavelength: 125 },
  { length: 17, maxWavelength: 17 / 6 },
  { length: 5, maxWavelength: 5 / 6 },
];
const RANGE = { kMin: (2 * Math.PI) / 2000, kMax: (Math.PI * 256) / 5, fetch: 100000 };

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}：${actual} 與預期 ${expected} 相差超過 ${tolerance}`);
};

test('只有湧浪時，有效波高等於設定值，尖峰週期等於湧浪週期', () => {
  for (const [height, period] of [[0.5, 9], [2, 12], [4, 18]]) {
    const stats = waveStatistics({ ...RANGE, windSpeed: 0.5, heightScale: 0, swellHeight: height, swellPeriod: period });
    close(stats.significantHeight, height, height * 0.01, '有效波高');
    close(stats.peakPeriod, period, period * 0.01, '尖峰週期');
  }
});

test('風浪與湧浪互相獨立，總波高是兩者的平方和開根號', () => {
  const wind = waveStatistics({ ...RANGE, windSpeed: 10, heightScale: 1 });
  const combined = waveStatistics({ ...RANGE, windSpeed: 10, heightScale: 1, swellHeight: 1.5, swellPeriod: 13 });
  close(combined.significantHeight, Math.hypot(wind.significantHeight, 1.5), 0.01, '合併波高');
});

test('浪高倍率只影響風浪，不影響湧浪', () => {
  const base = waveStatistics({ ...RANGE, windSpeed: 12, heightScale: 1 });
  const doubled = waveStatistics({ ...RANGE, windSpeed: 12, heightScale: 2, swellHeight: 1, swellPeriod: 12 });
  close(doubled.significantHeight, Math.hypot(2 * base.significantHeight, 1), 0.01, '合併波高');
});

test('湧浪很強時，尖峰週期改為湧浪的週期', () => {
  const stats = waveStatistics({ ...RANGE, windSpeed: 6, heightScale: 1, swellHeight: 3, swellPeriod: 15 });
  close(stats.peakPeriod, 15, 0.2, '尖峰週期');
});

test('湧浪方向分布在 -π 到 π 積分為 1', () => {
  const norm = swellSpreadNormalization(SWELL_SPREAD);
  const steps = 20000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const theta = -Math.PI + ((i + 0.5) / steps) * 2 * Math.PI;
    sum += norm * Math.abs(Math.cos(theta / 2)) ** (2 * SWELL_SPREAD);
  }
  close((sum * 2 * Math.PI) / steps, 1, 1e-4, '積分');
});

test('各層的波數分界遞增，且不超過該層的奈奎斯特頻率', () => {
  for (const size of [128, 256]) {
    const boundaries = cascadeBoundaries(size, CASCADES);
    assert.equal(boundaries.length, CASCADES.length - 1);
    boundaries.forEach((k, i) => {
      if (i > 0) assert.ok(k > boundaries[i - 1], '分界應遞增');
      assert.ok(k <= (Math.PI * size) / CASCADES[i].length * 0.9 + 1e-12, '不應超過奈奎斯特頻率的 90%');
    });
  }
  // 最大一層只負責波長超過 125 公尺的長浪（湧浪）
  close(cascadeBoundaries(256, CASCADES)[0], (2 * Math.PI) / 125, 1e-9, '第一個分界');
});
