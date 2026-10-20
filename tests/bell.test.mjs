// 鐘浮標鐘錘的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { BellClapper } from '../js/bell.js';

const DEG = Math.PI / 180;

// 浮標以 period 秒為週期左右搖晃 amplitude 度、同時做半徑 radius 公尺的軌道運動時，t 秒的姿態
function pose({ amplitude, period, radius }, t) {
  const omega = (2 * Math.PI) / period;
  const angle = amplitude * DEG * Math.sin(omega * t);
  return {
    center: [radius * Math.sin(omega * t), radius * Math.cos(omega * t), 0],
    up: [Math.sin(angle), Math.cos(angle), 0],
  };
}

// 每幀取樣一次並更新鐘錘，回傳所有撞擊速度
// delay 為讀回延遲的幀數；irregular 時讀回不一定每幀到達（像實際的非同步讀回）
function simulate({ seconds = 30, fps = 60, delay = 0, irregular = false, ...motion }) {
  const clapper = new BellClapper();
  const strikes = [];
  let pending = [];
  let seed = 1;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let frame = 0; frame < seconds * fps; frame++) {
    const t = frame / fps;
    pending.push({ t, ready: frame + delay + (irregular ? Math.floor(random() * 3) : 0) });
    // 已讀回的資料中只拿最新的一筆（和 js/wave-probe.js 一樣）
    const ready = pending.filter((p) => p.ready <= frame);
    pending = pending.filter((p) => p.ready > frame);
    if (ready.length) {
      const latest = ready[ready.length - 1];
      clapper.addSample(pose(motion, latest.t), latest.t);
    }
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

test('讀回延遲幾幀、到達時間不規則時，平靜的海面也不會亂響', () => {
  assert.equal(simulate({ amplitude: 3, period: 8, radius: 0.2, delay: 2, irregular: true }).length, 0);
  const regular = simulate({ amplitude: 18, period: 6, radius: 1 }).length;
  const irregular = simulate({ amplitude: 18, period: 6, radius: 1, delay: 2, irregular: true }).length;
  assert.ok(Math.abs(regular - irregular) <= Math.max(3, regular * 0.35), `規則 ${regular} 次、不規則 ${irregular} 次`);
});

test('取樣幀率不同時，響的次數差不多', () => {
  const at60 = simulate({ amplitude: 18, period: 6, radius: 1, fps: 60 }).length;
  const at24 = simulate({ amplitude: 18, period: 6, radius: 1, fps: 24 }).length;
  assert.ok(Math.abs(at60 - at24) <= Math.max(3, at60 * 0.35), `60 fps ${at60} 次、24 fps ${at24} 次`);
});
