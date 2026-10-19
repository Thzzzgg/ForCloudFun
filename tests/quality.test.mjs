// 自動畫質的單元測試：用模擬的裝置效能餵入每幀時間，檢查調整結果
// 執行方式：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../js/quality.js';

const TIERS = [
  { name: 'high', maxPixelRatio: 2 },
  { name: 'medium', maxPixelRatio: 1.5 },
  { name: 'low', maxPixelRatio: 1 },
];

function create(startTier = 'high', devicePixelRatio = 2) {
  return new AdaptiveQuality({ tiers: TIERS, startTier, devicePixelRatio });
}

// 依目前設定下的幀率逐幀推進一段模擬時間，回傳期間畫質變動的次數
function run(quality, fpsOf, seconds) {
  let time = 0;
  let changes = 0;
  while (time < seconds) {
    const frame = 1 / fpsOf(quality);
    if (quality.sample(frame)) changes++;
    time += frame;
  }
  return changes;
}

test('效能足夠時維持原本的畫質', () => {
  const quality = create();
  assert.equal(run(quality, () => 60, 60), 0);
  assert.equal(quality.tier, 'high');
  assert.equal(quality.scale, 1);
});

test('繪圖速度不足時降低解析度，直到幀率足夠', () => {
  // 幀時間與像素數成正比：像素比 2 時只有 25 fps
  const fpsOf = (q) => Math.min(60, 100 / q.pixelRatio ** 2);
  const quality = create();
  run(quality, fpsOf, 60);
  assert.equal(quality.tier, 'high');
  assert.ok(quality.scale < 1);
  assert.ok(fpsOf(quality) >= 45, `幀率 ${fpsOf(quality).toFixed(1)} 仍低於 45`);
});

test('螢幕更新率鎖在 30 fps 時，試過沒效就還原並停止調整', () => {
  const quality = create();
  run(quality, () => 30, 60);
  assert.equal(quality.tier, 'high');
  assert.equal(quality.scale, 1);
  assert.equal(quality.locked, true);
});

test('解析度不是瓶頸時，改為降低畫質等級', () => {
  // 幀率只跟網格與 FFT 的計算量（畫質等級）有關
  const fpsByTier = { high: 35, medium: 52, low: 60 };
  const quality = create();
  run(quality, (q) => fpsByTier[q.tier], 60);
  assert.equal(quality.tier, 'medium');
  assert.equal(quality.locked, false);
});

test('非常慢的裝置會一路降到幀率足夠為止', () => {
  const tierCost = { high: 1, medium: 0.7, low: 0.4 };
  const fpsOf = (q) => Math.min(60, 20 / (q.pixelRatio ** 2 * tierCost[q.tier]));
  const quality = create();
  run(quality, fpsOf, 120);
  assert.notEqual(quality.tier, 'high');
  assert.ok(fpsOf(quality) >= 45, `幀率 ${fpsOf(quality).toFixed(1)} 仍低於 45`);
});

test('偶發的長停頓不會觸發降級', () => {
  const quality = create();
  run(quality, () => 60, 10);
  assert.equal(quality.sample(0.8), false);
  run(quality, () => 60, 10);
  // 停頓剛好落在新一輪的開頭也一樣
  run(quality, () => 60, 1.5 - (quality.elapsed % 1.5));
  quality.sample(0.8);
  run(quality, () => 60, 10);
  assert.equal(quality.tier, 'high');
  assert.equal(quality.scale, 1);
});

test('分頁切到背景再回來，那段時間不列入計算', () => {
  const quality = create();
  run(quality, () => 60, 10);
  quality.pause();
  assert.equal(quality.sample(120), false);
  run(quality, () => 60, 10);
  assert.equal(quality.tier, 'high');
  assert.equal(quality.scale, 1);
});

test('啟動時先快後慢的幀（GPU 指令排隊）也能正確量到偏低的幀率', () => {
  const quality = create();
  for (const seconds of [0.18, 0.4, 0.13, 0.27, 0.98, 7.3, 5.8, 0.15, 5.5, 5.5]) quality.sample(seconds);
  assert.ok(quality.scale < 1);
});

test('換到較低等級時，實際解析度不會比換之前高', () => {
  const quality = create('high', 3);
  quality.scale = 0.5; // 像素比 2 × 0.5 = 1
  quality.lowerTier(20);
  assert.equal(quality.tier, 'medium');
  assert.ok(quality.pixelRatio <= 1 + 1e-9);
});

test('暫時變慢後恢復，解析度會逐步調回，但不超過曾經變慢的比例', () => {
  let slow = true;
  const fpsOf = (q) => (slow ? Math.min(60, 100 / q.pixelRatio ** 2) : 60);
  const quality = create();
  run(quality, fpsOf, 30);
  const lowered = quality.scale;
  assert.ok(lowered < 1);
  slow = false;
  run(quality, fpsOf, 60);
  assert.ok(quality.scale > lowered);
  assert.ok(quality.scale < 1);
});
