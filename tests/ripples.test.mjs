// 點擊水面的漣漪與水花粒子的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { Droplets, MAX_RIPPLES, RIPPLE_DEPTH, RIPPLE_LIFE, RIPPLE_RADIUS, Ripples, rippleAt } from '../js/ripples.js';

const GRAVITY = 9.81;

// J0 以積分式計算：J0(x) = (1/π)∫₀^π cos(x sin θ) dθ
function besselJ0(x) {
  const n = 64;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.cos(x * Math.sin(((i + 0.5) * Math.PI) / n));
  return sum / n;
}

// 精確解：η(r, t) = ∫ Â(k) J0(kr) cos(√(gk) t) k dk，Â(k) = −(A a² / 2) exp(−k² a² / 4)
function exactRipple(r, t, depth = RIPPLE_DEPTH, radius = RIPPLE_RADIUS) {
  const kMax = 7 / radius;
  const steps = 6000;
  const dk = kMax / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const k = (i + 0.5) * dk;
    const spectrum = -((depth * radius * radius) / 2) * Math.exp((-k * k * radius * radius) / 4);
    sum += spectrum * besselJ0(k * r) * Math.cos(Math.sqrt(GRAVITY * k) * t) * k * dk;
  }
  return sum;
}

// 某個時間點振幅最大的那一圈（主要的環）所在的距離與高度
function strongestRing(t) {
  let best = { r: 0, height: 0 };
  for (let r = 0.2; r < 4 * t + 5; r += 0.02) {
    const { height } = rippleAt(r, t);
    if (Math.abs(height) > Math.abs(best.height)) best = { r, height };
  }
  return best;
}

test('漣漪的近似解和數值積分的精確解在離中心幾個波長外一致', () => {
  for (const [t, radii] of [[4, [2.5, 3.2, 4.5, 5.8]], [8, [7.2, 8.5, 9.8]]]) {
    const scale = Math.abs(strongestRing(t).height);
    for (const r of radii) {
      const approx = rippleAt(r, t).height;
      const exact = exactRipple(r, t);
      assert.ok(Math.abs(approx - exact) < 0.15 * scale, `t=${t} s、r=${r} m：近似 ${approx.toFixed(4)}，精確 ${exact.toFixed(4)}`);
    }
  }
});

test('外圈是跑得快的長波、內圈是短波，主要的環以群速度往外擴散', () => {
  const t = 6;
  assert.ok(rippleAt(3, t).wavenumber > rippleAt(6, t).wavenumber);
  assert.ok(rippleAt(6, t).wavenumber > rippleAt(9, t).wavenumber);
  // 振幅最大的波數約為 √3 / a，群速度 ½√(g / k)：主要的環大約以這個速度往外走
  const k = Math.sqrt(3) / RIPPLE_RADIUS;
  const groupVelocity = 0.5 * Math.sqrt(GRAVITY / k);
  const early = strongestRing(4).r;
  const late = strongestRing(8).r;
  assert.ok(late / early > 1.6 && late / early < 2.4, `4 秒時 ${early.toFixed(2)} m，8 秒時 ${late.toFixed(2)} m`);
  assert.ok(Math.abs(late / 8 - groupVelocity) < 0.3 * groupVelocity, `擴散速度 ${(late / 8).toFixed(2)} m/s，群速度 ${groupVelocity.toFixed(2)} m/s`);
});

test('漣漪的振幅隨時間減弱；剛落水時落水處以外、以及前緣之外都沒有起伏', () => {
  let previous = Infinity;
  for (const t of [2, 4, 8, 16]) {
    const height = Math.abs(strongestRing(t).height);
    assert.ok(height < previous, `${t} 秒時 ${height.toFixed(4)} m`);
    previous = height;
  }
  assert.ok(Math.abs(strongestRing(2).height) > 0.01, '頭幾秒有幾公分高的漣漪');
  for (const r of [2, 5, 10]) assert.ok(Math.abs(rippleAt(r, 0).height) < 1e-5, `剛落水時 r=${r} m`);
  assert.ok(Math.abs(rippleAt(60, 4).height) < 1e-4, '4 秒時 60 公尺外還沒有漣漪');
});

test('漣漪最多同時存在 MAX_RIPPLES 個，太多時取代最舊的，時間到了就消失', () => {
  const ripples = new Ripples();
  for (let i = 0; i < MAX_RIPPLES + 2; i++) ripples.add(i, -i, i * 0.5);
  const now = (MAX_RIPPLES + 2) * 0.5;
  const { data, count } = ripples.pack(now);
  assert.equal(count, MAX_RIPPLES);
  assert.deepEqual([...data.slice(0, 4)], [2, -2, now - 1, Math.fround(RIPPLE_DEPTH)], '最舊的兩個被取代，資料為 (x, z, 經過時間, 深度)');
  assert.equal(ripples.pack(1 + RIPPLE_LIFE + 0.1).count, MAX_RIPPLES - 1, '經過 RIPPLE_LIFE 秒的漣漪移除');
  assert.equal(ripples.pack(1000).count, 0);
  assert.ok(ripples.pack(1000).data.every((v) => v === 0), '移除後的資料清為 0');
});

// 可重現的亂數
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

test('水花往上噴一兩公尺後落回水面，水柱比水冠晚一點出現', () => {
  const droplets = new Droplets();
  const center = [3, 0.4, -7];
  droplets.spawn(center, { random: seeded(7) });
  const spawned = droplets.count;
  assert.ok(spawned > 80, `一次濺起 ${spawned} 顆`);
  const out = new Float32Array(droplets.capacity * 8);
  const dt = 1 / 60;
  let top = -Infinity;
  let visibleEarly = 0;
  let visibleLater = 0;
  let sumX = 0;
  let sumZ = 0;
  let samples = 0;
  for (let step = 1; step <= 4 * 60; step++) {
    droplets.update(dt);
    const visible = droplets.pack(out);
    if (step === 3) visibleEarly = visible;
    if (step === 24) visibleLater = visible;
    for (let i = 0; i < visible; i++) {
      top = Math.max(top, out[i * 8 + 1]);
      sumX += out[i * 8] - center[0];
      sumZ += out[i * 8 + 2] - center[2];
      samples++;
      assert.ok(out[i * 8 + 7] > 0 && out[i * 8 + 7] <= 1, '不透明度在 0～1 之間');
    }
  }
  assert.ok(visibleEarly < visibleLater, `水柱晚一點出現：剛開始 ${visibleEarly} 顆，0.4 秒時 ${visibleLater} 顆`);
  assert.ok(top - center[1] > 0.8 && top - center[1] < 3, `最高噴到水面上 ${(top - center[1]).toFixed(2)} m`);
  assert.ok(Math.abs(sumX / samples) < 0.3 && Math.abs(sumZ / samples) < 0.3, '往四面八方均勻散開');
  assert.equal(droplets.count, 0, '4 秒後全部落回水面或消散');
});

test('水花粒子超過容量時不會溢出', () => {
  const droplets = new Droplets(150);
  for (let i = 0; i < 5; i++) droplets.spawn([0, 0, 0], { random: seeded(i + 1) });
  assert.equal(droplets.count, 150);
  droplets.update(1 / 60);
  assert.ok(droplets.count <= 150);
});
