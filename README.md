# 擬真海浪

以 WebGL2 即時模擬的擬真海洋網站。海面由 FFT（快速傅立葉轉換）海洋頻譜在 GPU 上計算，不使用任何外部函式庫。

## 功能

- **FFT 海洋模擬**：採用 JONSWAP 頻譜與 Donelan-Banner 方向分布，三層不同尺度（250 m、17 m、5 m）疊加，看不出重複圖樣。
- **擬真著色**：預先計算的大氣散射天空、Fresnel 反射、GGX 太陽高光、浪峰背光的次表面散射、遠處依坡度變異自動加大粗糙度。
- **白浪泡沫**：以海面擠壓程度（Jacobian）判斷浪頭，泡沫會殘留並慢慢消散；覆蓋率依風速參考 Monahan 經驗式。
- **浮標**：在 GPU 上取樣浮標所在位置的海面，讓它隨浪起伏、傾斜，頂端燈號每 4 秒閃一次。
- **海浪音效**：以 Web Audio 即時合成底噪、浪潮起伏與碎浪聲，節奏跟著浪的週期、強度跟著浪高變化。
- **參數控制面板**：可調整風速、風向、浪高倍率、浪尖銳度、白浪泡沫、海水顏色、音量與渲染品質，並顯示有效波高與尖峰週期。
- **自動畫質**：依實際幀率調整渲染解析度，解析度降到底仍不夠順時再降低畫質等級（海面網格與 FFT 尺寸）。若降低後沒有變快（例如螢幕更新率鎖在 30 fps），會還原並停止調整。
- **效能資訊**：面板中可展開查看顯示卡型號、目前畫質、渲染解析度、模擬與網格大小，方便比較不同裝置。
- **HDR 後製**：多重取樣抗鋸齒、光暈（bloom）、ACES 色調映射。

## 執行方式

網站使用 ES module 並以 `fetch` 載入 shader，必須透過網頁伺服器開啟，直接雙擊 `index.html` 無法執行。

```bash
python3 -m http.server 8000
```

接著用瀏覽器開啟 <http://localhost:8000>。

也可以直接用 GitHub Pages 發佈：在儲存庫的 **Settings → Pages** 選擇 `main` 分支的根目錄即可。

### 瀏覽器需求

需要支援 WebGL2 與 `EXT_color_buffer_float` 的瀏覽器，例如最新版的 Chrome、Edge、Firefox 或 Safari（iOS 15 以上）。畫質預設為「自動」，電腦從「高」、手機與平板從「中」開始，再依實際幀率調整；也可以在面板手動選擇高、中、低。

### 測試

```bash
node --test
```

會執行 `tests/` 中的單元測試（目前涵蓋自動畫質的判斷邏輯），需要 Node.js 18 以上。

### 除錯模式

網址加上 `?debug`（例如 `http://localhost:8000/?debug`）會開放 `window.__ocean` 除錯介面，可暫停畫面、讀取海況統計值與模擬貼圖。

## 專案結構

```
index.html              頁面與控制面板
css/style.css           樣式
js/main.js              進入點：初始化與主迴圈
js/gl.js                WebGL2 工具（shader、紋理、framebuffer）
js/spectrum.js          JONSWAP 參數、波高統計、高斯亂數
js/ocean-sim.js         GPU FFT 海洋模擬（多層 cascade）
js/ocean-surface.js     海面投影網格與繪製
js/sky.js               大氣散射天空與太陽光顏色
js/buoy.js              浮標幾何與繪製
js/post.js              HDR 渲染目標、光暈與色調映射
js/quality.js           自動畫質的判斷邏輯（不依賴 WebGL）
js/textures.js          程序產生的泡沫紋理
js/audio.js             Web Audio 海浪音效合成
js/ui.js                控制面板綁定
js/camera.js            攝影機矩陣
shaders/                所有 GLSL shader（common.glsl 由其他 shader include）
tests/                  單元測試（node --test）
```

## 技術筆記

1. **初始頻譜**（`spectrum-init.frag`）：對每個波向量 k 計算 JONSWAP × 方向分布，乘上固定的高斯亂數得到 h0(k)。只在海況參數改變時執行，所以拖動滑桿也很順暢。
2. **時間演進**（`spectrum-time.frag`）：h(k, t) = h0(k)·e^{-iωt} + conj(h0(-k))·e^{iωt}，同時算出水平位移與各個偏導數，兩兩打包成複數，一次 IFFT 得到 8 個實數場。頻率量化成基頻的整數倍，動畫每 1000 秒無縫循環。
3. **IFFT**（`fft.frag`）：Stockham 基數 2 演算法，水平、垂直各 log2(N) 回合。
4. **整理**（`assemble.frag`）：輸出位移、法線用的導數、坡度平方（mipmap 後估計遠處粗糙度），並以 Jacobian 追蹤泡沫。
5. **海面網格**（`ocean.vert`）：螢幕空間的投影網格，一路延伸到 20 公里外的地平線，依網格間距挑選 mipmap 層級以免遠處閃爍。
