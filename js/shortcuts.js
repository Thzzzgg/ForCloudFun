// 快捷鍵與畫面工具：按鍵對應的動作、截圖的檔名、全螢幕 API 的相容處理
// 不直接使用 document 等全域物件（由呼叫端傳入），可以在 Node 中測試（tests/shortcuts.test.mjs）

// 按鍵（不分大小寫）→ 動作；index.html 的按鈕提示與面板說明需與此一致（單元測試會比對）
export const SHORTCUTS = {
  p: 'screenshot', // 截圖
  f: 'fullscreen', // 切換全螢幕
  h: 'panel', // 隱藏或顯示整個面板
};

// 不會用字母打字的 input 類型：焦點在這些欄位上時照樣觸發快捷鍵
const NON_TYPING_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color']);

// 焦點所在的元素是否會用到字母鍵（文字欄位、下拉選單的逐字搜尋、可編輯的內容）
function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = String(target.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TYPING_INPUTS.has(String(target.type ?? 'text').toLowerCase());
}

// 鍵盤事件 → 動作名稱；不是快捷鍵時回傳 null
// 按著 Ctrl、⌘ 或 Alt（瀏覽器與系統的快捷鍵，例如 ⌘H、Ctrl+P）、長按自動重複、輸入法組字中，
// 或在會打字的欄位裡時都不觸發
export function shortcutFor(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;
  return SHORTCUTS[String(event.key ?? '').toLowerCase()] ?? null;
}

const pad = (value) => String(value).padStart(2, '0');

// 截圖的檔名：擬真海浪-年月日-時分秒.png（裝置的當地時間）
export function screenshotName(date) {
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `擬真海浪-${day}-${clock}.png`;
}

// 全螢幕：舊版 Safari（iPadOS 16.3 以前）只有 webkit 前綴的版本；iPhone 不支援網頁元素全螢幕
export function fullscreenSupported(doc) {
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function fullscreenActive(doc) {
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

// 進入或離開全螢幕（整個頁面，面板也跟著進入全螢幕）；必須在點擊或按鍵的事件裡同步呼叫
// 回傳 Promise，舊版 Safari 的 webkit 版本沒有回傳值
export async function setFullscreen(doc, on) {
  if (on) {
    const root = doc.documentElement;
    if (root.requestFullscreen) return root.requestFullscreen({ navigationUI: 'hide' });
    return root.webkitRequestFullscreen?.();
  }
  if (doc.exitFullscreen) return doc.exitFullscreen();
  return doc.webkitExitFullscreen?.();
}
