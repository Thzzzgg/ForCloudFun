// 進入點：初始化 WebGL、各模組與控制面板，並執行主迴圈
import { createContext, loadShaderSources, Program, UserFacingError } from './gl.js';
import { waveStatistics } from './spectrum.js';
import { OceanSimulation } from './ocean-sim.js';
import { OceanSurface } from './ocean-surface.js';
import { Sky, sunDirection, sunColor } from './sky.js';
import { Buoy } from './buoy.js';
import { PostProcess } from './post.js';
import { createFoamDetailTexture } from './textures.js';
import { OceanAudio } from './audio.js';
import { createControls } from './ui.js';
import { createCamera, updateCamera } from './camera.js';
import { AdaptiveQuality } from './quality.js';

const SHADERS = [
  'common.glsl', 'fullscreen.vert',
  'spectrum-init.frag', 'spectrum-time.frag', 'fft.frag', 'assemble.frag',
  'sky-precompute.frag', 'sky.frag', 'ocean.vert', 'ocean.frag', 'buoy.vert', 'buoy.frag',
  'bloom-prefilter.frag', 'bloom-down.frag', 'bloom-up.frag', 'composite.frag',
];

const CONFIG = {
  // 四層海面區塊：邊長（公尺）與該層負責的最長波長；最大一層負責湧浪與最長的風浪
  cascades: [
    { length: 2000 },
    { length: 250, maxWavelength: 125 },
    { length: 17, maxWavelength: 17 / 6 },
    { length: 5, maxWavelength: 5 / 6 },
  ],
  fetch: 100000, // 風區長度（公尺）
  maxDistance: 20000, // 海面延伸到 20 公里外
  fogDensity: 1 / 9000,
  sun: { elevation: 24, azimuth: 32 },
  camera: { pitch: -7, fovY: 50 },
  buoyAnchor: [-6, -24],
  exposure: 0.55,
  bloomStrength: 0.35,
};

const QUALITY = {
  high: { label: '高', fftSize: 256, grid: [720, 300], maxPixelRatio: 2 },
  medium: { label: '中', fftSize: 256, grid: [480, 200], maxPixelRatio: 1.5 },
  low: { label: '低', fftSize: 128, grid: [320, 140], maxPixelRatio: 1 },
};
const QUALITY_TIERS = ['high', 'medium', 'low'].map((name) => ({ name, maxPixelRatio: QUALITY[name].maxPixelRatio }));
// 自動畫質的起始等級：觸控裝置（手機、平板）從「中」開始
const AUTO_START_TIER = window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';

const DEFAULTS = {
  windSpeed: 10,
  windDirection: 160,
  heightScale: 1,
  choppiness: 0.9,
  swellHeight: 1,
  swellDirection: 200,
  swellPeriod: 12,
  foam: 0.5,
  waterColor: '#0e6a77',
  volume: 0.6,
  quality: 'auto',
};

const SEA_STATE_KEYS = ['windSpeed', 'windDirection', 'heightScale', 'swellHeight', 'swellDirection', 'swellPeriod'];

const statusBox = document.getElementById('status');
const statusText = document.getElementById('status-text');

function showError(error) {
  console.error(error);
  statusText.textContent = error instanceof UserFacingError
    ? error.message
    : `發生錯誤，無法顯示海洋：${String(error.message).split('\n')[0]}`;
  statusBox.classList.add('error');
  statusBox.classList.remove('hidden');
}

// 泡沫門檻：先用 Monahan 經驗式估計白浪覆蓋率（約與風速的 3.4 次方成正比），
// 泡沫量滑桿再放大或縮小，最後依實測的紊流值分布換算成門檻
function foamBias(foam, windSpeed) {
  if (foam <= 0) return -10;
  const coverage = Math.min(Math.max(1e-5 * windSpeed ** 3.41 * (foam / 0.5) ** 2, 1e-3), 0.5);
  return 1.03 + 0.115 * Math.log10(coverage);
}

function srgbHexToLinear(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [16, 8, 0].map((shift) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}

function buildPrograms(gl, sources) {
  const fullscreen = (fragment) => new Program(gl, sources['fullscreen.vert'], sources[fragment], fragment);
  return {
    spectrumInit: fullscreen('spectrum-init.frag'),
    spectrumTime: fullscreen('spectrum-time.frag'),
    fft: fullscreen('fft.frag'),
    assemble: fullscreen('assemble.frag'),
    skyPrecompute: fullscreen('sky-precompute.frag'),
    sky: fullscreen('sky.frag'),
    ocean: new Program(gl, sources['ocean.vert'], sources['ocean.frag'], 'ocean'),
    buoy: new Program(gl, sources['buoy.vert'], sources['buoy.frag'], 'buoy'),
    bloomPrefilter: fullscreen('bloom-prefilter.frag'),
    bloomDown: fullscreen('bloom-down.frag'),
    bloomUp: fullscreen('bloom-up.frag'),
    composite: fullscreen('composite.frag'),
  };
}

async function main() {
  const canvas = document.getElementById('ocean');
  const debug = new URLSearchParams(location.search).has('debug');
  const gl = createContext(canvas, { preserveDrawingBuffer: debug });
  const sources = await loadShaderSources(new URL('../shaders/', import.meta.url), SHADERS);
  const programs = buildPrograms(gl, sources);

  const params = { ...DEFAULTS };
  const sunDir = sunDirection(CONFIG.sun.elevation, CONFIG.sun.azimuth);
  const sunRadiance = sunColor(sunDir);
  const sky = new Sky(gl, programs);
  sky.precompute(sunDir);
  const foamDetail = createFoamDetailTexture(gl);
  const post = new PostProcess(gl, programs);
  const buoy = new Buoy(gl, programs.buoy, { anchor: CONFIG.buoyAnchor });
  const camera = createCamera(CONFIG.camera);
  const audio = new OceanAudio();

  let simulation = null;
  let surface = null;
  let tier = null; // 目前使用的畫質等級
  let adaptive = null; // 自動畫質控制器（手動選擇畫質時為 null）
  let seaStateDirty = true;
  let stats = { significantHeight: 0, peakPeriod: 0 };

  const ui = createControls(params, {
    onChange(key) {
      if (key === 'quality') applyQuality();
      else if (key === 'volume') audio.setVolume(params.volume);
      else if (SEA_STATE_KEYS.includes(key)) seaStateDirty = true;
    },
    onAudioToggle: () => audio.setEnabled(!audio.enabled),
    onReset() {
      const previousQuality = params.quality;
      Object.assign(params, DEFAULTS);
      seaStateDirty = true;
      audio.setVolume(params.volume);
      if (params.quality !== previousQuality) applyQuality();
    },
  });
  if (!audio.supported) ui.disableAudio();

  const devicePixelRatio = () => window.devicePixelRatio || 1;

  function resize() {
    const ratio = adaptive ? adaptive.pixelRatio : Math.min(devicePixelRatio(), QUALITY[tier].maxPixelRatio);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      showPerformance();
    }
    post.resize(width, height);
  }

  // 切換畫質等級：FFT 尺寸相同時沿用原本的模擬（保留泡沫狀態），只重建海面網格
  function setTier(name) {
    const preset = QUALITY[name];
    if (!simulation || simulation.size !== preset.fftSize) {
      simulation?.dispose();
      simulation = new OceanSimulation(gl, programs, { size: preset.fftSize, cascades: CONFIG.cascades });
      seaStateDirty = true;
    }
    if (name !== tier || !surface) {
      surface?.dispose();
      surface = new OceanSurface(gl, programs.ocean, { columns: preset.grid[0], rows: preset.grid[1] });
    }
    tier = name;
  }

  function applyQuality() {
    adaptive = params.quality === 'auto'
      ? new AdaptiveQuality({ tiers: QUALITY_TIERS, startTier: AUTO_START_TIER, devicePixelRatio: devicePixelRatio() })
      : null;
    setTier(adaptive ? adaptive.tier : params.quality);
    resize();
    showPerformance();
  }

  // 面板的「效能資訊」，方便在不同裝置上比較
  function showPerformance() {
    const preset = QUALITY[tier];
    let quality = preset.label;
    if (adaptive) {
      quality = `自動 · ${preset.label}`;
      if (adaptive.scale < 0.995) quality += ` · 解析度 ${Math.round(adaptive.scale * 100)}%`;
    }
    ui.setPerformance({
      renderer: gl.caps.renderer,
      quality,
      resolution: `${canvas.width} × ${canvas.height}`,
      simulation: `${preset.fftSize}² × ${CONFIG.cascades.length} 層`,
      grid: `${preset.grid[0]} × ${preset.grid[1]}`,
      antialiasing: post.samples > 1 ? `MSAA ${post.samples}×` : '無',
    });
  }

  function updateSeaState() {
    const seaState = {
      windSpeed: params.windSpeed,
      windDirection: (params.windDirection * Math.PI) / 180,
      heightScale: params.heightScale,
      fetch: CONFIG.fetch,
      swellHeight: params.swellHeight,
      swellDirection: (params.swellDirection * Math.PI) / 180,
      swellPeriod: params.swellPeriod,
    };
    simulation.setSeaState(seaState);
    stats = waveStatistics({ ...seaState, kMin: simulation.kMin, kMax: simulation.kMax });
    audio.setSeaState(stats.significantHeight, stats.peakPeriod);
    ui.setStats(stats);
    seaStateDirty = false;
  }

  applyQuality();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) adaptive?.pause();
  });

  let running = true;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    running = false;
    showError(new UserFacingError('WebGL 繪圖環境遺失，請重新整理頁面。'));
  });

  let paused = false;
  // 網址加上 ?debug 時開放除錯介面（暫停畫面、讀取狀態）
  if (debug) {
    window.__ocean = {
      gl,
      params,
      camera,
      getStats: () => stats,
      getSimulation: () => simulation,
      setPaused: (value) => { paused = value; },
      markSeaStateDirty: () => { seaStateDirty = true; },
      getQuality,
      // 直接餵一個幀率給自動畫質，測試降級與升級流程
      simulateFps(fps) {
        if (adaptive?.evaluate(fps)) applyAdaptiveChange();
        return getQuality();
      },
    };
  }

  function getQuality() {
    return {
      mode: params.quality,
      tier,
      scale: adaptive ? adaptive.scale : 1,
      locked: adaptive ? adaptive.locked : false,
      canvas: [canvas.width, canvas.height],
      fftSize: simulation.size,
    };
  }

  function applyAdaptiveChange() {
    if (adaptive.tier !== tier) setTier(adaptive.tier);
    resize();
    showPerformance();
  }

  let time = 0;
  let last = performance.now();
  let cameraHeight = null;
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let firstFrame = true;

  function frame(now) {
    if (!running) return;
    const elapsed = Math.max((now - last) / 1000, 0);
    const dt = Math.min(elapsed, 0.1); // 分頁切回來時避免一次跳太多
    last = now;
    if (paused) {
      requestAnimationFrame(frame);
      return;
    }
    time += dt;

    if (adaptive) {
      adaptive.devicePixelRatio = devicePixelRatio();
      if (adaptive.sample(elapsed)) applyAdaptiveChange();
    }
    resize();
    if (seaStateDirty) updateSeaState();

    // 浪越大鏡頭越高，避免被浪淹沒
    const targetHeight = Math.min(Math.max(2.2 + 1.5 * stats.significantHeight, 3.5), 30);
    cameraHeight = cameraHeight === null
      ? targetHeight
      : cameraHeight + (targetHeight - cameraHeight) * (1 - Math.exp(-dt * 1.2));
    camera.position[1] = cameraHeight;
    updateCamera(camera, canvas.width / canvas.height);

    simulation.update(time, dt, params.choppiness);

    post.beginScene();
    sky.draw(camera, sunDir, sunRadiance);
    const shared = { camera, simulation, sky, sunDir, sunRadiance, time, fogDensity: CONFIG.fogDensity };
    surface.draw({
      ...shared,
      foamDetail,
      scatterColor: srgbHexToLinear(params.waterColor),
      foamBias: foamBias(params.foam, params.windSpeed),
      maxDistance: CONFIG.maxDistance,
    });
    buoy.draw(shared);
    post.endScene();
    post.render({ exposure: CONFIG.exposure, bloomStrength: CONFIG.bloomStrength, time });

    fpsFrames++;
    fpsElapsed += elapsed;
    if (fpsElapsed >= 0.5) {
      ui.setStats({ framesPerSecond: fpsFrames / fpsElapsed });
      fpsFrames = 0;
      fpsElapsed = 0;
    }
    if (firstFrame) {
      firstFrame = false;
      statusBox.classList.add('hidden');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(showError);
