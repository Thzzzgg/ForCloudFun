// 記住上次的設定與分享網址（不依賴 DOM）
// - 設定存在瀏覽器的 localStorage，下次開啟時還原；讀寫失敗（例如私密瀏覽）時當作沒有存過
// - 分享網址把海況、天氣與時間放在查詢字串裡，例如 ?time=18.5&wind=12&clouds=0.4，開啟時套用
// 讀進來的值一律檢查：數值限制在面板滑桿的範圍內，格式不對的直接略過

// 各參數的格式；share 為分享網址裡的名稱（沒有的只記在這台裝置上，例如畫質與音量）
// 數值範圍需與 index.html 的滑桿一致（單元測試會比對）
export const SETTINGS = {
  time: { share: 'time', min: 0, max: 24 },
  cloudCoverage: { share: 'clouds', min: 0, max: 1 },
  visibility: { share: 'visibility', min: 1, max: 50 },
  windSpeed: { share: 'wind', min: 2, max: 25 },
  windDirection: { share: 'windDir', min: 0, max: 355 },
  heightScale: { share: 'height', min: 0.2, max: 2 },
  choppiness: { share: 'chop', min: 0, max: 1.5 },
  swellHeight: { share: 'swell', min: 0, max: 4 },
  swellDirection: { share: 'swellDir', min: 0, max: 355 },
  swellPeriod: { share: 'swellPeriod', min: 8, max: 18 },
  foam: { share: 'foam', min: 0, max: 1 },
  waterColor: { share: 'water', type: 'color' },
  scenery: { share: 'life', type: 'boolean' },
  viewMode: { share: 'view', choices: ['orbit', 'boat'] },
  volume: { min: 0, max: 1 },
  quality: { choices: ['auto', 'high', 'medium', 'low'] },
};

const STORAGE_KEY = 'ocean.settings';
const STORAGE_VERSION = 1;

// 檢查並轉換一個值；不合法時回傳 undefined
function validate(spec, value) {
  if (spec.type === 'color') {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(value));
    return match ? `#${match[1].toLowerCase()}` : undefined;
  }
  if (spec.type === 'boolean') {
    if (value === true || value === '1' || value === 'true') return true;
    if (value === false || value === '0' || value === 'false') return false;
    return undefined;
  }
  if (spec.choices) return spec.choices.includes(value) ? value : undefined;
  if (value === '' || value === null || typeof value === 'boolean') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(Math.max(number, spec.min), spec.max);
}

// 只留下合法的參數（其他的忽略）
function sanitize(entries) {
  const result = {};
  for (const [key, value] of entries) {
    const spec = SETTINGS[key];
    if (!spec) continue;
    const checked = validate(spec, value);
    if (checked !== undefined) result[key] = checked;
  }
  return result;
}

// 數值寫成短一點的字串：最多兩位小數，去掉多餘的 0
const compact = (value) => String(Math.round(value * 100) / 100);

// 目前的海況 → 分享網址的查詢字串（不含 ?）
export function encodeShare(params) {
  const query = new URLSearchParams();
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (!spec.share) continue;
    const value = params[key];
    if (spec.type === 'color') query.set(spec.share, String(value).replace('#', ''));
    else if (spec.type === 'boolean') query.set(spec.share, value ? '1' : '0');
    else if (spec.choices) query.set(spec.share, value);
    else query.set(spec.share, compact(value));
  }
  return query.toString();
}

// 網址的查詢字串 → 分享的參數（只取認得的名稱，值不合法的略過）
export function decodeShare(search) {
  const query = new URLSearchParams(search);
  const entries = [];
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (spec.share && query.has(spec.share)) entries.push([key, query.get(spec.share)]);
  }
  return sanitize(entries);
}

// 拿掉網址裡分享用的參數，其他的（例如 ?debug）保留；回傳新的網址
export function stripShare(href) {
  const url = new URL(href);
  for (const spec of Object.values(SETTINGS)) {
    if (spec.share) url.searchParams.delete(spec.share);
  }
  // URLSearchParams 會把 ?debug 寫成 ?debug=，還原成原本的樣子
  url.search = url.searchParams.toString().replace(/=(&|$)/g, '$1');
  return url.toString();
}

// 分享網址：目前頁面的網址（不含 ?debug 等其他參數）加上海況
export function shareUrl(href, params) {
  const url = new URL(href);
  url.search = encodeShare(params);
  url.hash = '';
  return url.toString();
}

// 讀出上次存的設定；沒有、格式不對或讀取失敗時回傳空物件
export function loadSettings(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (!saved || saved.version !== STORAGE_VERSION || typeof saved.params !== 'object') return {};
    return sanitize(Object.entries(saved.params));
  } catch {
    return {};
  }
}

// 存下目前的設定（只存 SETTINGS 列出的參數）；寫入失敗時略過
export function saveSettings(storage, params) {
  const values = Object.fromEntries(Object.keys(SETTINGS).map((key) => [key, params[key]]));
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, params: values }));
  } catch {
    // 空間不足或不允許存取
  }
}

export function clearSettings(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // 不允許存取
  }
}
