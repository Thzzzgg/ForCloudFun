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

const SHADERS = [
  'common.glsl', 'fullscreen.vert',
  'spectrum-init.frag', 'spectrum-time.frag', 'fft.frag', 'assemble.frag',
  'sky-precompute.frag', 'sky.frag', 'ocean.vert', 'ocean.frag', 'buoy.vert', 'buoy.frag',
  'bloom-prefilter.frag', 'bloom-down.frag', 'bloom-up.frag', 'composite.frag',
];

const CONFIG = {
  cascadeLengths: [250, 17, 5], // 三層海面區塊的邊長（公尺）
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
  high: { fftSize: 256, grid: [720, 300], maxPixelRatio: 2 },
  medium: { fftSize: 256, grid: [480, 200], maxPixelRatio: 1.5 },
  low: { fftSize: 128, grid: [320, 140], maxPixelRatio: 1 },
};

const DEFAULTS = {
  windSpeed: 10,
  windDirection: 160,
  heightScale: 1,
  choppiness: 0.9,
  foam: 0.5,
  waterColor: '#0e6a77',
  volume: 0.6,
  quality: window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high',
};

const SEA_STATE_KEYS = ['windSpeed', 'windDirection', 'heightScale'];

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
  let preset = null;
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

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    post.resize(width, height);
  }

  function applyQuality() {
    preset = QUALITY[params.quality];
    simulation?.dispose();
    surface?.dispose();
    simulation = new OceanSimulation(gl, programs, { size: preset.fftSize, lengths: CONFIG.cascadeLengths });
    surface = new OceanSurface(gl, programs.ocean, { columns: preset.grid[0], rows: preset.grid[1] });
    seaStateDirty = true;
    resize();
  }

  function updateSeaState() {
    const seaState = {
      windSpeed: params.windSpeed,
      windDirection: (params.windDirection * Math.PI) / 180,
      heightScale: params.heightScale,
      fetch: CONFIG.fetch,
    };
    simulation.setSeaState(seaState);
    stats = waveStatistics({ ...seaState, kMin: simulation.kMin, kMax: simulation.kMax });
    audio.setSeaState(stats.significantHeight, stats.peakPeriod);
    ui.setStats(stats);
    seaStateDirty = false;
  }

  applyQuality();

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
    };
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
