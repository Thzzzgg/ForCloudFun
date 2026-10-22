// 瀏覽器測試：在無頭 Chromium 載入網站，走過幾種海況與互動，檢查 shader 編譯、JS 錯誤、檔案載入與畫面
// 沒有顯示卡的環境（例如 GitHub Actions）以 SwiftShader 軟體繪圖：抓得到 GLSL 的語法與連結錯誤、JS 錯誤與
// 載入失敗的檔案，但抓不到特定顯示卡驅動程式才有的問題
//
// 需要 Playwright（只有測試用，不是網站的依賴，所以不放進專案）：
//   npm install --no-save playwright@1.56.1
//   npx playwright install chromium
//   node tests/browser.mjs
// 各個場景的畫面與下載的截圖存到 BROWSER_TEST_OUTPUT（預設為系統暫存資料夾下的 ocean-browser-test）
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_PATH = '/ForCloudFun/'; // 和 GitHub Pages 一樣放在子路徑底下，確認網站只用相對路徑
const OUTPUT = process.env.BROWSER_TEST_OUTPUT ?? join(tmpdir(), 'ocean-browser-test');
const VIEWPORT = { width: 640, height: 360 };
const FIRST_FRAME_TIMEOUT = 300000; // 軟體繪圖編譯 shader 很慢
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
};

// 靜態檔案伺服器：把專案根目錄掛在 BASE_PATH 底下
function startServer() {
  const server = createServer(async (request, response) => {
    let file;
    try {
      const { pathname } = new URL(request.url, 'http://localhost');
      const relative = decodeURIComponent(pathname.slice(BASE_PATH.length));
      file = normalize(join(ROOT, relative === '' || relative.endsWith('/') ? `${relative}index.html` : relative));
      if (!pathname.startsWith(BASE_PATH) || !file.startsWith(ROOT)) {
        response.writeHead(404).end();
        return;
      }
    } catch {
      response.writeHead(400).end(); // 格式錯誤的網址
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const failures = [];
function check(ok, message) {
  console.log(`  ${ok ? '✓' : '✗'} ${message}`);
  if (!ok) failures.push(message);
}

mkdirSync(OUTPUT, { recursive: true });
const server = await startServer();
const url = `http://127.0.0.1:${server.address().port}${BASE_PATH}?debug`;
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  // 下載檔案的中文檔名需要 UTF-8 語系（有些 Linux 容器預設不是）
  env: { ...process.env, LANG: 'C.UTF-8' },
});
const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
const page = await context.newPage();

// 主控台的錯誤與警告、未處理的例外、載入失敗的檔案都算失敗
const problems = [];
// shader 編譯失敗的訊息附上整份加了行號的原始碼：只留錯誤訊息與出錯那幾行的前後；其他太長的訊息只留前 30 行
const shorten = (text) => {
  const lines = text.split('\n');
  const errorLines = [...text.matchAll(/ERROR: \d+:(\d+):/g)].map((match) => Number(match[1]));
  if (errorLines.length) {
    return lines.filter((line) => {
      const numbered = /^\s*(\d+): /.exec(line);
      return !numbered || errorLines.some((n) => Math.abs(n - Number(numbered[1])) <= 3);
    }).join('\n');
  }
  return lines.length > 30 ? `${lines.slice(0, 30).join('\n')}\n…（還有 ${lines.length - 30} 行）` : text;
};
page.on('console', (message) => {
  if (!['error', 'warning'].includes(message.type())) return;
  if (message.text().includes('GPU stall due to ReadPixels')) return; // 軟體繪圖讀回資料時的效能提示
  problems.push(`主控台${message.type() === 'error' ? '錯誤' : '警告'}：${shorten(message.text())}`);
});
page.on('pageerror', (error) => problems.push(`未處理的例外：${error.message}`));
page.on('requestfailed', (request) => {
  if (!request.url().startsWith('blob:')) problems.push(`無法載入：${request.url()}（${request.failure()?.errorText}）`);
});
page.on('response', (response) => {
  if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) problems.push(`HTTP ${response.status()}：${response.url()}`);
});

// 等畫面再畫完 n 幀；畫面停住（例如 WebGL 繪圖環境遺失）時兩分鐘後放棄
const frames = (n) => page.evaluate((n) => new Promise((resolve, reject) => {
  const target = window.__ocean.getFrameCount() + n;
  const timer = setTimeout(() => reject(new Error(`等了兩分鐘還沒畫完 ${n} 幀`)), 120000);
  const poll = () => {
    if (window.__ocean.getFrameCount() < target) return setTimeout(poll, 50);
    clearTimeout(timer);
    return resolve();
  };
  poll();
}), n);

const setRange = (id, value) => page.evaluate(([id, value]) => {
  const input = document.getElementById(id);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, [id, value]);

// 畫面的平均亮度、亮度的變化，以及全黑像素的比例（shader 算出 NaN 時通常是黑的）
// 除錯模式保留繪圖緩衝，可以直接讀畫布
const sceneStats = () => page.evaluate(() => {
  const source = document.getElementById('ocean');
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = Math.round((160 * source.height) / source.width);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  let squares = 0;
  let black = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    sum += luminance;
    squares += luminance * luminance;
    if (Math.max(data[i], data[i + 1], data[i + 2]) <= 1) black++;
  }
  const count = data.length / 4;
  const mean = sum / count;
  return { mean, deviation: Math.sqrt(Math.max(squares / count - mean * mean, 0)), black: black / count };
});

// 存下目前的畫面（只有海，不含面板）
const saveScene = async (name) => {
  const dataUrl = await page.evaluate(() => document.getElementById('ocean').toDataURL('image/png'));
  writeFileSync(join(OUTPUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
};

const pngSize = (bytes) => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
const percent = (value) => `${(value * 100).toFixed(1)}%`;

async function scene(title, file, { minMean, maxMean = 0.9, minDeviation = 0.02, maxBlack = 0.01 }) {
  const stats = await sceneStats();
  check(stats.mean > minMean && stats.mean < maxMean,
    `${title}：平均亮度 ${stats.mean.toFixed(3)}（${minMean}～${maxMean}），亮度變化 ${stats.deviation.toFixed(3)}，全黑像素 ${percent(stats.black)}`);
  check(stats.deviation > minDeviation, `${title}：畫面不是單一顏色`);
  if (maxBlack < 1) check(stats.black < maxBlack, `${title}：沒有成片的黑色（全黑像素少於 ${percent(maxBlack)}）`);
  await saveScene(file);
}

const started = Date.now();
try {
  console.log(`載入 ${url}`);
  await page.goto(url, { timeout: FIRST_FRAME_TIMEOUT });
  // 網站顯示錯誤（例如 shader 編譯失敗）時不用等到逾時
  await page.waitForFunction(() => window.__ocean?.getFrameCount() > 3 || document.getElementById('status').classList.contains('error'),
    null, { timeout: FIRST_FRAME_TIMEOUT });
  const failed = await page.evaluate(() => document.getElementById('status').classList.contains('error') && document.getElementById('status-text').textContent);
  if (failed) throw new Error(`網站顯示錯誤：${failed}`);
  console.log(`第一幀畫完：${((Date.now() - started) / 1000).toFixed(0)} 秒，顯示卡 ${await page.evaluate(() => window.__ocean.gl.caps.renderer)}`);

  console.log('預設海況（下午 4 點）');
  await frames(5);
  check(await page.evaluate(() => document.getElementById('status').classList.contains('hidden')), '載入畫面已經收起，沒有顯示錯誤');
  const sea = await page.evaluate(() => ({ stats: window.__ocean.getStats(), probe: window.__ocean.getProbe()[0] }));
  check(sea.stats.significantHeight > 0.5 && sea.stats.significantHeight < 5, `有效波高 ${sea.stats.significantHeight.toFixed(2)} m`);
  const water = sea.probe?.displacement ?? [];
  check(water.length === 3 && water.every(Number.isFinite) && Math.abs(water[1]) < 10, `讀回鏡頭位置的海面高度：${water.length ? `${water[1].toFixed(2)} m` : '沒有資料'}`);
  await scene('預設海況', '1-default.png', { minMean: 0.15 });

  console.log('開啟音效、狂風、點擊水面');
  await page.click('#audioToggle');
  await page.waitForFunction(() => document.getElementById('audioToggle').getAttribute('aria-pressed') === 'true', null, { timeout: 30000 });
  check(true, '音效已開啟');
  await page.click('[data-preset="gale"]');
  await frames(3);
  // 拾取結果非同步讀回，軟體繪圖要等上十來幀
  await page.evaluate(() => window.__ocean.splashAt(-6, -12));
  const rippled = await page.waitForFunction(() => window.__ocean.splashes.ripples.list.length > 0, null, { timeout: 60000 })
    .then(() => true, () => false);
  check(rippled, '點擊水面泛起漣漪');
  await frames(3);
  await scene('狂風', '2-gale.png', { minMean: 0.08 });

  console.log('夜晚（晚上 10 點，平靜）');
  await page.click('[data-preset="calm"]');
  await setRange('time', 22);
  await frames(6);
  await scene('夜晚', '3-night.png', { minMean: 0.003, maxMean: 0.5, minDeviation: 0.002, maxBlack: 1 });

  console.log('船上視角（早上 7 點）');
  await setRange('time', 7);
  await page.click('[data-view="boat"]');
  await frames(10);
  await scene('船上視角', '4-boat.png', { minMean: 0.1 });

  console.log('畫質「低」與截圖');
  await page.selectOption('#quality', 'low');
  await frames(4);
  const quality = await page.evaluate(() => window.__ocean.getQuality());
  check(quality.fftSize === 128 && quality.tier === 'low', `畫質「低」改用 ${quality.fftSize}² 的 FFT`);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#screenshot')]);
  const shot = join(OUTPUT, '5-screenshot.png');
  await download.saveAs(shot);
  const size = pngSize(readFileSync(shot));
  check(size.join('×') === quality.canvas.join('×'), `截圖 ${size.join('×')}，和畫布一樣大`);
  check(/^擬真海浪-\d{8}-\d{6}\.png$/.test(download.suggestedFilename()), `截圖檔名 ${download.suggestedFilename()}`);

  console.log('快捷鍵與恢復預設值');
  await page.focus('#ocean');
  await page.keyboard.press('h');
  check(await page.evaluate(() => document.body.classList.contains('panel-hidden')), '按 H 隱藏面板');
  await page.keyboard.press('h');
  check(await page.evaluate(() => !document.body.classList.contains('panel-hidden')), '再按 H 顯示面板');
  await page.click('#reset');
  await frames(3);
  check(await page.evaluate(() => window.__ocean.params.time === 16 && window.__ocean.params.viewMode === 'orbit'), '恢復預設值');
} catch (error) {
  check(false, `測試中斷：${error.message.split('\n')[0]}`);
} finally {
  check(problems.length === 0, problems.length ? `主控台與載入的問題：\n    ${problems.join('\n    ')}` : '主控台沒有錯誤或警告，所有檔案都載入成功');
  await browser.close();
  server.close();
}

console.log(`\n${failures.length ? `失敗 ${failures.length} 項` : '全部通過'}（${((Date.now() - started) / 1000).toFixed(0)} 秒），畫面存在 ${OUTPUT}`);
process.exitCode = failures.length ? 1 : 0;
