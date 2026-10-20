// 強風效果強度的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { foamStreaks, sprayAmount, windVelocity } from '../js/storm.js';

test('蒲福 6 級以下沒有條紋與飛沫，10 級時最強', () => {
  for (const speed of [2, 8, 10.8]) {
    assert.equal(foamStreaks(speed), 0, `風速 ${speed} 的條紋`);
    assert.equal(sprayAmount(speed), 0, `風速 ${speed} 的飛沫`);
  }
  assert.equal(foamStreaks(25), 1);
  assert.equal(sprayAmount(25), 1);
});

test('風越強效果越明顯；條紋比飛沫早出現', () => {
  let previous = { streaks: 0, spray: 0 };
  for (let speed = 12; speed <= 25; speed += 0.5) {
    const current = { streaks: foamStreaks(speed), spray: sprayAmount(speed) };
    assert.ok(current.streaks >= previous.streaks && current.spray >= previous.spray, `風速 ${speed}`);
    assert.ok(current.streaks >= current.spray, `風速 ${speed} 時條紋應不少於飛沫`);
    previous = current;
  }
  assert.ok(sprayAmount(17) > 0, '蒲福 8 級（17 m/s）已有飛沫');
});

test('風速向量與面板的方向一致：0° 往遠方（-z）、90° 往右（+x）', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  const [x0, z0] = windVelocity(0, 10);
  close(x0, 0);
  close(z0, -10);
  const [x90, z90] = windVelocity(90, 10);
  close(x90, 10);
  close(z90, 0);
  close(Math.hypot(...windVelocity(160, 7)), 7);
});
