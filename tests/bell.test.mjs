// 鐘浮標鐘錘的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { BellClapper } from '../js/bell.js';

const DEG = Math.PI / 180;

// 模擬浮標以 period 秒為週期左右搖晃 amplitude 度、同時做半徑 radius 公尺的軌道運動，回傳所有撞擊速度
function simulate({ amplitude, period, radius, seconds = 30, fps = 60 }) {
  const clapper = new BellClapper();
  const strikes = [];
  const omega = (2 * Math.PI) / period;
  for (let frame = 0; frame < seconds * fps; frame++) {
    const t = frame / fps;
    const angle = amplitude * DEG * Math.sin(omega * t);
    clapper.addSample({
      center: [radius * Math.sin(omega * t), radius * Math.cos(omega * t), 0],
      up: [Math.sin(angle), Math.cos(angle), 0],
    });
    strikes.push(...clapper.update(1 / fps));
  }
  return strikes;
}

test('浮標不動時鐘不會響', () => {
  assert.deepEqual(simulate({ amplitude: 0, period: 6, radius: 0 }), []);
});

test('只是微微晃動時鐘錘碰不到鐘', () => {
  assert.equal(simulate({ amplitude: 3, period: 8, radius: 0.2 }).length, 0);
});

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

test('搖晃得夠大時鐘會響，晃得越厲害敲得越用力', () => {
  const moderate = simulate({ amplitude: 12, period: 6, radius: 0.8 });
  const strong = simulate({ amplitude: 22, period: 6, radius: 1.5 });
  assert.ok(moderate.length > 0 && strong.length > 0, '中等與劇烈搖晃都應該會響');
  assert.ok(mean(strong) > mean(moderate), `劇烈搖晃平均 ${mean(strong)} m/s，中等 ${mean(moderate)} m/s`);
  assert.ok([...moderate, ...strong].every((speed) => speed > 0), '撞擊速度為正');
});

test('鐘錘貼著鐘壁時不會連續響個不停', () => {
  // 每個搖晃週期大約響兩次（往兩邊各撞一次），不會每一小步都算一響
  const strikes = simulate({ amplitude: 18, period: 6, radius: 1, seconds: 60 });
  assert.ok(strikes.length <= 60, `一分鐘響了 ${strikes.length} 次`);
});

test('取樣幀率不同時，響的次數差不多', () => {
  const at60 = simulate({ amplitude: 18, period: 6, radius: 1, fps: 60 }).length;
  const at24 = simulate({ amplitude: 18, period: 6, radius: 1, fps: 24 }).length;
  assert.ok(Math.abs(at60 - at24) <= Math.max(3, at60 * 0.35), `60 fps ${at60} 次、24 fps ${at24} 次`);
});
