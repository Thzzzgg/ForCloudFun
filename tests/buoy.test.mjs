// 浮標吃水線泡沫強度的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buoyFoamAmount } from '../js/buoy.js';

test('平靜海面幾乎沒有吃水線泡沫，有效波高 2.5 公尺以上最多', () => {
  assert.equal(buoyFoamAmount(0), 0);
  assert.equal(buoyFoamAmount(0.3), 0);
  assert.equal(buoyFoamAmount(2.5), 1);
  assert.equal(buoyFoamAmount(6), 1);
});

test('浪越大，吃水線泡沫越多', () => {
  let previous = 0;
  for (let height = 0; height <= 3; height += 0.1) {
    const amount = buoyFoamAmount(height);
    assert.ok(amount >= previous, `有效波高 ${height.toFixed(1)} m`);
    previous = amount;
  }
});
