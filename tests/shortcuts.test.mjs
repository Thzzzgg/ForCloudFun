// 快捷鍵、截圖檔名與全螢幕的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fullscreenActive, fullscreenSupported, screenshotName, setFullscreen, SHORTCUTS, shortcutFor } from '../js/shortcuts.js';

const CANVAS = { tagName: 'CANVAS' };
const press = (key, extra = {}) => ({ key, target: CANVAS, ...extra });

test('P 截圖、F 全螢幕、H 隱藏面板，大小寫都可以', () => {
  assert.equal(shortcutFor(press('p')), 'screenshot');
  assert.equal(shortcutFor(press('F', { shiftKey: true })), 'fullscreen');
  assert.equal(shortcutFor(press('h')), 'panel');
  assert.equal(shortcutFor({ key: 'H' }), 'panel', '焦點不在任何元素上時');
  for (const key of ['x', 'ArrowLeft', '0', ' ', 'Escape', undefined]) assert.equal(shortcutFor(press(key)), null, String(key));
});

test('按著 Ctrl、⌘ 或 Alt、長按自動重複、輸入法組字中或已經處理過的按鍵不觸發', () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }, { defaultPrevented: true }]) {
    assert.equal(shortcutFor(press('h', extra)), null, JSON.stringify(extra));
  }
});

test('在文字欄位、下拉選單與可編輯的內容裡不觸發；滑桿、顏色、按鈕與畫面上可以', () => {
  const typing = [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT' },
    { tagName: 'INPUT', type: 'search' },
    { tagName: 'input', type: 'number' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ];
  for (const target of typing) assert.equal(shortcutFor({ key: 'f', target }), null, JSON.stringify(target));
  const others = [{ tagName: 'INPUT', type: 'range' }, { tagName: 'INPUT', type: 'color' }, { tagName: 'BUTTON' }, CANVAS, { tagName: 'BODY' }];
  for (const target of others) assert.equal(shortcutFor({ key: 'f', target }), 'fullscreen', JSON.stringify(target));
});

test('按鈕提示與面板上的鍵盤說明和快捷鍵一致', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const labels = { screenshot: '截圖', fullscreen: '全螢幕', panel: '隱藏面板' };
  assert.deepEqual(Object.values(SHORTCUTS).sort(), Object.keys(labels).sort());
  for (const [key, action] of Object.entries(SHORTCUTS)) {
    assert.ok(html.includes(`${key.toUpperCase()} ${labels[action]}`), `鍵盤說明：${key.toUpperCase()} ${labels[action]}`);
  }
  // 截圖與全螢幕按鈕的 id 就是動作名稱，提示文字與 aria-keyshortcuts 標示同一個鍵
  for (const [key, action] of Object.entries(SHORTCUTS).filter(([, a]) => a !== 'panel')) {
    const button = html.match(new RegExp(`<button id="${action}"[^>]*>`))?.[0] ?? '';
    const upper = key.toUpperCase();
    assert.ok(button.includes(`aria-keyshortcuts="${upper}"`) && button.includes(`（${upper}）`), button || action);
  }
  assert.ok(html.includes('按 H 完全隱藏'), '收合按鈕的提示');
});

test('截圖的檔名帶著當地的日期與時間，不含檔名不能用的字元', () => {
  assert.equal(screenshotName(new Date(2026, 9, 22, 8, 5, 3)), '擬真海浪-20261022-080503.png');
  const name = screenshotName(new Date(2027, 0, 1, 23, 59, 59));
  assert.equal(name, '擬真海浪-20270101-235959.png');
  assert.doesNotMatch(name, /[\\/:*?"<>|]/);
});

test('全螢幕：支援標準與 webkit 前綴的版本，兩者都沒有時當作不支援', async () => {
  assert.equal(fullscreenSupported({ fullscreenEnabled: true }), true);
  assert.equal(fullscreenSupported({ webkitFullscreenEnabled: true }), true);
  assert.equal(fullscreenSupported({ fullscreenEnabled: false }), false, '例如沒有允許全螢幕的 iframe');
  assert.equal(fullscreenSupported({}), false, '例如 iPhone');

  const calls = [];
  const standard = {
    fullscreenElement: null,
    documentElement: { requestFullscreen: async (options) => calls.push(['request', options]) },
    exitFullscreen: async () => calls.push(['exit']),
  };
  assert.equal(fullscreenActive(standard), false);
  await setFullscreen(standard, true);
  standard.fullscreenElement = standard.documentElement;
  assert.equal(fullscreenActive(standard), true);
  await setFullscreen(standard, false);
  assert.deepEqual(calls, [['request', { navigationUI: 'hide' }], ['exit']]);

  // 舊版 Safari：只有 webkit 前綴的版本，而且沒有回傳 Promise
  const webkit = {
    webkitFullscreenElement: null,
    documentElement: { webkitRequestFullscreen: () => { calls.push(['webkit request']); } },
    webkitExitFullscreen: () => { calls.push(['webkit exit']); },
  };
  await setFullscreen(webkit, true);
  webkit.webkitFullscreenElement = webkit.documentElement;
  assert.equal(fullscreenActive(webkit), true);
  await setFullscreen(webkit, false);
  assert.deepEqual(calls.slice(2), [['webkit request'], ['webkit exit']]);
});

test('全螢幕要在點擊或按鍵的事件裡同步要求，被拒絕時回傳失敗的 Promise', async () => {
  let requested = false;
  const doc = {
    documentElement: {
      requestFullscreen: () => {
        requested = true;
        return Promise.reject(new TypeError('Permissions check failed'));
      },
    },
  };
  const pending = setFullscreen(doc, true);
  assert.equal(requested, true, '呼叫當下就要求，不能等到之後的 microtask');
  await assert.rejects(pending, TypeError);
});
