// 天氣參數換算的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudThreshold, fogDensity, hazeDepth, CLEAR_VISIBILITY } from '../js/weather.js';

test('雲量越多，雲層噪音的門檻越低', () => {
  let previous = Infinity;
  for (let coverage = 0; coverage <= 1.0001; coverage += 0.05) {
    const threshold = cloudThreshold(coverage);
    assert.ok(threshold < previous, `雲量 ${coverage.toFixed(2)} 的門檻 ${threshold} 沒有比前一個低`);
    previous = threshold;
  }
});

test('雲量 0 時門檻高於噪音最大值，100% 時低於最小值；超出範圍時取端點', () => {
  assert.ok(cloudThreshold(0) >= 0.9);
  assert.ok(cloudThreshold(1) < 0);
  assert.equal(cloudThreshold(-0.5), cloudThreshold(0));
  assert.equal(cloudThreshold(1.5), cloudThreshold(1));
});

test('能見度換算消光係數（Koschmieder）：能見度處的對比剩 2%', () => {
  for (const km of [1, 5, 35]) {
    const contrast = Math.exp(-fogDensity(km) * km * 1000);
    assert.ok(Math.abs(contrast - 0.02) < 0.0005, `能見度 ${km} km 時對比為 ${contrast}`);
  }
});

test('能見度低於晴天時才有額外的霧，越低越濃', () => {
  assert.equal(hazeDepth(CLEAR_VISIBILITY), 0);
  assert.equal(hazeDepth(50), 0);
  assert.ok(hazeDepth(20) > 0);
  assert.ok(hazeDepth(1) > hazeDepth(5));
  assert.ok(hazeDepth(5) > hazeDepth(20));
});
