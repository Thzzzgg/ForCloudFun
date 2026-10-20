// 天氣參數的換算：雲量 → 雲層噪音的門檻、能見度 → 霧的濃度

// 雲量與門檻的對照：實測 clouds.glsl 的 fBm 分布，取 (1 - 雲量) 的分位數，
// 再減掉雲的柔和邊緣（約 0.06），這樣雲量 30% 時，看起來大約三成的天空有雲；
// 雲量 100% 時門檻低於最小值，整片都是雲
const COVERAGE_TABLE = [
  [0, 0.9], [0.02, 0.697], [0.1, 0.618], [0.2, 0.564], [0.3, 0.522], [0.5, 0.45],
  [0.7, 0.376], [0.8, 0.334], [0.9, 0.278], [0.98, 0.194], [1, -0.1],
];

export function cloudThreshold(coverage) {
  const c = Math.min(Math.max(coverage, 0), 1);
  for (let i = 1; i < COVERAGE_TABLE.length; i++) {
    const [c1, t1] = COVERAGE_TABLE[i];
    if (c <= c1) {
      const [c0, t0] = COVERAGE_TABLE[i - 1];
      return t0 + ((c - c0) / (c1 - c0)) * (t1 - t0);
    }
  }
  return COVERAGE_TABLE[COVERAGE_TABLE.length - 1][1];
}

// Koschmieder 公式：能見度是對比降到 2% 的距離，消光係數 = 3.912 / 能見度
export function fogDensity(visibilityKm) {
  return 3.912 / (Math.max(visibilityKm, 0.1) * 1000);
}

// 預先計算的天空已經含有晴天的薄霾（相當於能見度 35 公里）
export const CLEAR_VISIBILITY = 35;
const HAZE_LAYER = 1000; // 低能見度時的霧層厚度（公尺）

// 能見度低於晴天時多出來的霧，在天頂方向的光學深度；天空與光源都用它變朦朧
export function hazeDepth(visibilityKm) {
  return Math.max(fogDensity(visibilityKm) - fogDensity(CLEAR_VISIBILITY), 0) * HAZE_LAYER;
}
