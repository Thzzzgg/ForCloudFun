// 浮標姿態與吃水線泡沫強度的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buoyFoamAmount, buoyPose } from '../js/buoy.js';

test('浮標的位置跟著海面位移，傾斜比海面小一些', () => {
  const flat = buoyPose([-6, -24], { displacement: [0.5, 1.2, -0.3], slope: [0, 0] });
  assert.deepEqual(flat.center, [-5.5, 1.2, -24.3]);
  flat.up.forEach((v, i) => assert.ok(Math.abs(v - [0, 1, 0][i]) < 1e-12, `平靜時朝正上方：${flat.up}`));
  // 海面往 +x 方向升高（坡度 0.2）時，浮標往 -x 傾斜，角度約為海面的 85%
  const { up } = buoyPose([0, 0], { displacement: [0, 0, 0], slope: [0.2, 0] });
  const tilt = Math.atan2(-up[0], up[1]);
  assert.ok(Math.abs(Math.hypot(...up) - 1) < 1e-12, '單位向量');
  assert.ok(tilt > 0.8 * Math.atan(0.2) && tilt < 0.9 * Math.atan(0.2), `傾斜 ${tilt}`);
});

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
