// 海鷗的飛行模型與模型的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGullGeometry, GULL_FLOATS, GullFlock, gullWelcome } from '../js/gulls.js';

const DAY = { sunElevation: 0.4, windSpeed: 8, wind: [3, -7] };
const NIGHT = { ...DAY, sunElevation: -0.2 };

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

test('海鷗白天才出來，風太大時去避風', () => {
  assert.equal(gullWelcome({ sunElevation: 0.5, windSpeed: 8 }), 1);
  assert.equal(gullWelcome({ sunElevation: -0.1, windSpeed: 8 }), 0);
  assert.equal(gullWelcome({ sunElevation: 0.5, windSpeed: 25 }), 0);
  const dusk = gullWelcome({ sunElevation: 0.02, windSpeed: 8 });
  assert.ok(dusk > 0 && dusk < 1, `黃昏時只剩幾隻：${dusk}`);
});

test('海鷗以 8～13 m/s 盤旋，高度與範圍合理，轉彎時往內側傾', () => {
  const home = [-6, -24];
  const flock = new GullFlock({ home, random: seeded(3) });
  const dt = 1 / 60;
  let previous = null;
  let flapping = 0;
  let samples = 0;
  let banked = 0;
  let turning = 0;
  for (let step = 0; step < 60 * 90; step++) {
    flock.update(dt, DAY);
    const yaws = flock.gulls.map((g) => g.yaw);
    if (previous && step > 30) {
      flock.gulls.forEach((gull, i) => {
        const speed = Math.hypot(...gull.position.map((v, k) => v - previous.positions[i][k])) / dt;
        assert.ok(speed > 7 && speed < 14, `速度 ${speed.toFixed(1)} m/s`);
        assert.ok(gull.position[1] > 2 && gull.position[1] < 35, `高度 ${gull.position[1].toFixed(1)} m`);
        assert.ok(Math.hypot(gull.position[0] - home[0], gull.position[2] - home[1]) < 100, '在浮標附近');
        const yawRate = Math.atan2(Math.sin(yaws[i] - previous.yaws[i]), Math.cos(yaws[i] - previous.yaws[i])) / dt;
        if (Math.abs(yawRate) > 0.2) {
          turning++;
          // 往左轉（航向角增加）時往左傾，側傾角為負
          if (Math.sign(gull.roll) === -Math.sign(yawRate)) banked++;
        }
        if (gull.flap > 0.5) flapping++;
        samples++;
      });
    }
    previous = { positions: flock.gulls.map((g) => [...g.position]), yaws };
  }
  assert.ok(banked / turning > 0.95, `轉彎時往內側傾的比例 ${(banked / turning).toFixed(2)}`);
  const flapShare = flapping / samples;
  assert.ok(flapShare > 0.1 && flapShare < 0.6, `大多在滑翔，拍翅的時間比例 ${flapShare.toFixed(2)}`);
});

test('入夜後海鷗慢慢飛走，天亮後再飛回來', () => {
  const flock = new GullFlock({ random: seeded(5) });
  flock.update(0.1, DAY);
  assert.equal(flock.visible.length, flock.gulls.length, '白天一開始就在');
  let seconds = 0;
  for (; seconds < 120 && flock.visible.length; seconds += 0.1) flock.update(0.1, NIGHT);
  assert.ok(seconds > 20 && seconds < 60, `入夜後 ${seconds.toFixed(1)} 秒全部飛走`);
  for (let i = 0; i < 600; i++) flock.update(0.1, DAY);
  assert.ok(flock.gulls.every((g) => g.presence === 1), '天亮後全部回來');
});

test('海鷗偶爾叫幾聲，飛走後就安靜了', () => {
  const flock = new GullFlock({ random: seeded(9) });
  let calls = [];
  for (let i = 0; i < 60 * 60 * 3; i++) calls.push(...flock.update(1 / 60, DAY));
  const perMinute = calls.length / 3;
  assert.ok(perMinute > 2 && perMinute < 8, `每分鐘叫 ${perMinute.toFixed(1)} 次`);
  assert.ok(calls.every((call) => call.notes >= 2 && call.notes <= 5 && call.position.length === 3));
  for (let i = 0; i < 60 * 60; i++) flock.update(1 / 60, NIGHT);
  calls = [];
  for (let i = 0; i < 60 * 60; i++) calls.push(...flock.update(1 / 60, NIGHT));
  assert.equal(calls.length, 0, '夜晚沒有叫聲');
});

test('海鷗的模型：翼展約 1.3 公尺，法線為單位向量，分成身體與內外兩段翅膀', () => {
  const data = buildGullGeometry();
  assert.equal(data.length % (GULL_FLOATS * 3), 0, '完整的三角形');
  let span = 0;
  const parts = new Set();
  for (let i = 0; i < data.length; i += GULL_FLOATS) {
    span = Math.max(span, Math.abs(data[i]));
    assert.ok(Math.abs(Math.hypot(data[i + 3], data[i + 4], data[i + 5]) - 1) < 1e-6, '法線長度為 1');
    parts.add(data[i + 12]);
  }
  assert.ok(span * 2 > 1.2 && span * 2 < 1.45, `翼展 ${(span * 2).toFixed(2)} m`);
  assert.deepEqual([...parts].sort(), [0, 1, 2]);
});
