// 自動畫質：依實際幀率調整渲染解析度，解析度降到底仍不夠順時再降低畫質等級
// 只有判斷邏輯、不碰 WebGL，可以直接在 Node 中測試（tests/quality.test.mjs）

const WINDOW_SECONDS = 1.5; // 每累積 1.5 秒（且至少 3 幀）的畫面評估一次平均幀率
const MIN_FRAMES = 3;
const WARMUP_SECONDS = 2; // 啟動或換等級後先不計算（shader 編譯、重建資源會卡頓）
const SETTLE_SECONDS = 0.5; // 改解析度後重建緩衝區的短暫卡頓
const LOW_FPS = 45; // 低於此幀率就降低畫質
const HIGH_FPS = 57; // 連續幾輪都高於此幀率才提高解析度
const GOOD_WINDOWS_TO_RAISE = 3;
const MIN_SCALE = 0.5;
const SCALE_DOWN = 0.8;
const SCALE_UP = 1.1;
const REQUIRED_GAIN = 1.08; // 降低畫質後幀率至少要提升 8%，否則表示瓶頸不在這裡
const TRIM_RATIO = 0.1; // 每輪去掉最長的 10% 幀（至少一幀）再平均

export class AdaptiveQuality {
  // tiers：由高到低排列的畫質等級 [{ name, maxPixelRatio }]
  constructor({ tiers, startTier, devicePixelRatio = 1 }) {
    this.tiers = tiers;
    this.tierIndex = Math.max(0, tiers.findIndex((t) => t.name === startTier));
    this.devicePixelRatio = devicePixelRatio;
    this.scale = 1; // 相對於此等級最高解析度的比例
    this.ceiling = Infinity; // 曾經在這個比例變慢，之後提高解析度時不再超過它
    this.locked = false; // 降低畫質也沒有變快時停止調整
    this.pending = null; // 上一次降低畫質前的狀態，下一輪用來確認是否有效
    this.goodWindows = 0;
    this.skipNext = false;
    this.lastFps = null;
    this.restartWindow(WARMUP_SECONDS);
  }

  get tier() {
    return this.tiers[this.tierIndex].name;
  }

  // 實際使用的像素比例 = min(裝置像素比, 此等級上限) × 比例
  get pixelRatio() {
    return Math.min(this.devicePixelRatio, this.tiers[this.tierIndex].maxPixelRatio) * this.scale;
  }

  restartWindow(warmup = 0) {
    this.warmup = warmup;
    this.intervals = [];
    this.elapsed = 0;
  }

  // 分頁切到背景時呼叫：回來後的第一幀包含在背景的時間，不列入計算
  pause() {
    this.restartWindow(this.warmup);
    this.skipNext = true;
  }

  // 每幀呼叫一次，傳入這一幀經過的秒數；畫質有變動時回傳 true
  sample(seconds) {
    if (this.skipNext) {
      this.skipNext = false;
      return false;
    }
    if (this.warmup > 0) {
      this.warmup -= seconds;
      return false;
    }
    this.intervals.push(seconds);
    this.elapsed += seconds;
    if (this.elapsed < WINDOW_SECONDS || this.intervals.length < MIN_FRAMES) return false;
    // 去掉最長的幾幀再平均，偶發的停頓（垃圾回收等）不會被誤判成效能不足
    const sorted = this.intervals.sort((a, b) => a - b);
    const kept = sorted.slice(0, sorted.length - Math.max(1, Math.floor(sorted.length * TRIM_RATIO)));
    const fps = kept.length / kept.reduce((sum, value) => sum + value, 0);
    this.restartWindow();
    return this.evaluate(fps);
  }

  evaluate(fps) {
    this.lastFps = fps;
    if (this.pending) {
      const before = this.pending;
      this.pending = null;
      if (fps < before.fps * REQUIRED_GAIN) {
        // 降低後沒有變快：瓶頸不在這裡（例如被螢幕更新率或 CPU 限制），先還原
        this.tierIndex = before.tierIndex;
        this.scale = before.scale;
        this.ceiling = before.ceiling;
        // 降解析度沒用時，改試降低畫質等級（減少海面網格與 FFT 計算量）
        if (before.kind === 'scale' && this.tierIndex < this.tiers.length - 1) return this.lowerTier(before.fps);
        this.locked = true;
        this.restartWindow(before.kind === 'tier' ? WARMUP_SECONDS : SETTLE_SECONDS);
        return true;
      }
    }
    if (this.locked) return false;

    if (fps < LOW_FPS) {
      this.goodWindows = 0;
      if (this.scale > MIN_SCALE + 1e-3) return this.lowerScale(fps);
      if (this.tierIndex < this.tiers.length - 1) return this.lowerTier(fps);
      return false;
    }
    if (fps < HIGH_FPS) {
      this.goodWindows = 0;
      return false;
    }
    this.goodWindows++;
    if (this.goodWindows < GOOD_WINDOWS_TO_RAISE) return false;
    this.goodWindows = 0;
    const target = Math.min(this.scale * SCALE_UP, 1, this.ceiling * 0.95);
    if (target <= this.scale + 0.01) return false;
    this.scale = target;
    this.restartWindow(SETTLE_SECONDS);
    return true;
  }

  lowerScale(fps) {
    this.pending = { kind: 'scale', fps, tierIndex: this.tierIndex, scale: this.scale, ceiling: this.ceiling };
    this.ceiling = Math.min(this.ceiling, this.scale);
    this.scale = Math.max(MIN_SCALE, this.scale * SCALE_DOWN);
    this.restartWindow(SETTLE_SECONDS);
    return true;
  }

  lowerTier(fps) {
    this.pending = { kind: 'tier', fps, tierIndex: this.tierIndex, scale: this.scale, ceiling: this.ceiling };
    const pixelRatio = this.pixelRatio;
    this.tierIndex++;
    // 換到較低等級時，實際解析度不超過換之前
    const cap = Math.min(this.devicePixelRatio, this.tiers[this.tierIndex].maxPixelRatio);
    this.scale = Math.max(MIN_SCALE, Math.min(1, pixelRatio / cap));
    this.ceiling = Infinity;
    this.restartWindow(WARMUP_SECONDS);
    return true;
  }
}
