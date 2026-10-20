// 蒲福風級與一鍵套用的海況預設（不依賴 DOM 與 WebGL）
// 風級的風速範圍依世界氣象組織（WMO）的標準（海面上 10 公尺的平均風速），名稱用中央氣象署的用語

// 各級風速的上限（m/s，不含）：0 級未滿 0.3、1 級未滿 1.6……12 級為 32.7 以上
const UPPER_LIMITS = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
const NAMES = ['無風', '軟風', '輕風', '微風', '和風', '清風', '強風', '疾風', '大風', '烈風', '狂風', '暴風', '颶風'];

// 風速（m/s）換算成蒲福風級：{ level: 0～12, name }
export function beaufort(windSpeed) {
  const index = UPPER_LIMITS.findIndex((limit) => windSpeed < limit);
  const level = index < 0 ? UPPER_LIMITS.length : index;
  return { level, name: NAMES[level] };
}

// 海況預設：風速、湧浪高度（公尺）、雲量（0～1）與能見度（公里）一起改變，浪高倍率回到 1，其他參數不變
// 風速分別落在蒲福 2、4、6、10 級，按鈕名稱（平靜以外）就是該級的名稱
export const SEA_PRESETS = {
  calm: { windSpeed: 2.5, swellHeight: 0.3, cloudCoverage: 0, visibility: 35, heightScale: 1 },
  moderate: { windSpeed: 6, swellHeight: 0.8, cloudCoverage: 0.1, visibility: 35, heightScale: 1 },
  strong: { windSpeed: 12, swellHeight: 1.5, cloudCoverage: 0.4, visibility: 25, heightScale: 1 },
  gale: { windSpeed: 25, swellHeight: 4, cloudCoverage: 0.95, visibility: 6, heightScale: 1 },
};
