// 記住設定與分享網址的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearSettings, decodeShare, encodeShare, loadSettings, saveSettings, SETTINGS, shareUrl, stripShare } from '../js/settings.js';

const SCENE = {
  time: 18.5,
  cloudCoverage: 0.4,
  visibility: 25,
  windSpeed: 12,
  windDirection: 160,
  heightScale: 1,
  choppiness: 0.9,
  swellHeight: 1.5,
  swellDirection: 200,
  swellPeriod: 12,
  foam: 0.5,
  waterColor: '#0e6a77',
  scenery: false,
  viewMode: 'boat',
  volume: 0.3,
  quality: 'medium',
  timelapse: true,
};

// 只實作 getItem / setItem / removeItem 的假 localStorage
class MemoryStorage {
  items = new Map();
  getItem(key) { return this.items.has(key) ? this.items.get(key) : null; }
  setItem(key, value) { this.items.set(key, String(value)); }
  removeItem(key) { this.items.delete(key); }
}

test('分享網址帶著海況、天氣與時間，開啟後還原成一樣的參數', () => {
  const query = encodeShare(SCENE);
  const decoded = decodeShare(`?${query}`);
  const shared = Object.keys(SETTINGS).filter((key) => SETTINGS[key].share);
  assert.deepEqual(Object.keys(decoded).sort(), shared.sort());
  for (const key of shared) assert.equal(decoded[key], SCENE[key], key);
  assert.ok(!query.includes('volume') && !query.includes('quality'), '音量與畫質只記在自己的裝置上');
  assert.ok(query.includes('time=18.5') && query.includes('water=0e6a77') && query.includes('life=0'), query);
});

test('分享網址的數值最多兩位小數', () => {
  const query = new URLSearchParams(encodeShare({ ...SCENE, time: 16.123456, cloudCoverage: 1 / 3 }));
  assert.equal(query.get('time'), '16.12');
  assert.equal(query.get('clouds'), '0.33');
});

test('網址裡不認得的名稱、不合法的值都略過，超出範圍的數值限制在滑桿範圍內', () => {
  const decoded = decodeShare('?wind=99&clouds=-1&time=abc&water=red&life=maybe&view=plane&foo=1&visibility=');
  assert.deepEqual(decoded, { windSpeed: 25, cloudCoverage: 0 });
  assert.deepEqual(decodeShare('?water=%2300AAff&life=1&view=orbit'), { waterColor: '#00aaff', scenery: true, viewMode: 'orbit' });
  assert.deepEqual(decodeShare(''), {});
});

test('數值範圍與 index.html 的滑桿一致', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sliders = new Map(
    [...html.matchAll(/<input type="range" id="(\w+)" min="([\d.]+)" max="([\d.]+)"/g)].map(([, id, min, max]) => [id, [+min, +max]]),
  );
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (spec.min === undefined) continue;
    assert.deepEqual([spec.min, spec.max], sliders.get(key), key);
  }
  for (const choice of SETTINGS.quality.choices) assert.ok(html.includes(`<option value="${choice}">`), `畫質選項 ${choice}`);
  for (const choice of SETTINGS.viewMode.choices) assert.ok(html.includes(`data-view="${choice}"`), `視角 ${choice}`);
});

test('拿掉網址裡的分享參數時保留 ?debug 等其他參數；分享網址不帶其他參數', () => {
  assert.equal(stripShare('http://localhost:8000/?debug&wind=12&time=6'), 'http://localhost:8000/?debug');
  assert.equal(stripShare('http://localhost:8000/?wind=12'), 'http://localhost:8000/');
  assert.equal(stripShare('https://example.com/sea/index.html?lang=zh&clouds=1#top'), 'https://example.com/sea/index.html?lang=zh#top');
  const url = new URL(shareUrl('http://localhost:8000/?debug#x', SCENE));
  assert.equal(url.origin + url.pathname, 'http://localhost:8000/');
  assert.equal(url.searchParams.has('debug'), false);
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('wind'), '12');
});

test('設定存進瀏覽器後讀得回來，不包含縮時播放這類暫時的狀態', () => {
  const storage = new MemoryStorage();
  saveSettings(storage, SCENE);
  const loaded = loadSettings(storage);
  assert.equal(loaded.timelapse, undefined);
  for (const key of Object.keys(SETTINGS)) assert.equal(loaded[key], SCENE[key], key);
  clearSettings(storage);
  assert.deepEqual(loadSettings(storage), {});
});

test('存的資料壞掉、版本不同或讀寫失敗時，當作沒有存過', () => {
  const storage = new MemoryStorage();
  storage.setItem('ocean.settings', '{not json');
  assert.deepEqual(loadSettings(storage), {});
  storage.setItem('ocean.settings', JSON.stringify({ version: 999, params: { windSpeed: 5 } }));
  assert.deepEqual(loadSettings(storage), {});
  storage.setItem('ocean.settings', JSON.stringify({ version: 1, params: { windSpeed: 5, visibility: 'far', hacker: 1 } }));
  assert.deepEqual(loadSettings(storage), { windSpeed: 5 });
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
  assert.deepEqual(loadSettings(broken), {});
  assert.doesNotThrow(() => saveSettings(broken, SCENE));
  assert.doesNotThrow(() => clearSettings(broken));
  assert.deepEqual(loadSettings(null), {}, '取不到 localStorage 時');
});
