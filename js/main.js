// 進入點：初始化 WebGL、各模組與控制面板，並執行主迴圈
import { createContext, loadShaderSources, Program, UserFacingError } from './gl.js';
import { waveStatistics } from './spectrum.js';
import { OceanSimulation } from './ocean-sim.js';
import { OceanSurface } from './ocean-surface.js';
import { Sky, skyLighting } from './sky.js';
import { sunDirection, moonDirection, skyRotation } from './celestial.js';
import { cloudThreshold, fogDensity, hazeDepth } from './weather.js';
import { foamStreaks, sprayAmount, windVelocity } from './storm.js';
import { Spray } from './spray.js';
import { Buoy, BUOY_FOOTPRINT, buoyFoamAmount, buoyPose } from './buoy.js';
import { BellClapper } from './bell.js';
import { PostProcess } from './post.js';
import { createFoamDetailTexture } from './textures.js';
import { OceanAudio } from './audio.js';
import { createControls } from './ui.js';
import { createCamera, updateCamera } from './camera.js';
import { CameraRig, orbitPosition } from './camera-rig.js';
import { attachCameraInput } from './camera-input.js';
import { WaveProbe } from './wave-probe.js';
import { AdaptiveQuality } from './quality.js';

const SHADERS = [
  'common.glsl', 'atmosphere.glsl', 'clouds.glsl', 'buoy.glsl', 'fullscreen.vert',
  'spectrum-init.frag', 'spectrum-time.frag', 'fft.frag', 'assemble.frag', 'probe.frag',
  'sky-transmittance.frag', 'sky-multiscatter.frag', 'sky-precompute.frag', 'sky-clouds.frag', 'sky.frag',
  'ocean.vert', 'ocean.frag', 'buoy.vert', 'buoy.frag', 'spray-update.frag', 'spray.vert', 'spray.frag',
  'bloom-prefilter.frag', 'bloom-down.frag', 'bloom-up.frag', 'composite.frag',
];

const DEG = Math.PI / 180;
const BUOY_PROBE = 2; // 海面取樣中浮標的位置：鏡頭與船（rig.probePoints()）之後

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
  buoyAnchor: [-6, -24],
  // 預設視角（角度單位：度）：環繞浮標時從浮標後方略偏左看過去，讓陽光反射落在畫面右側
  view: {
    orbit: { yaw: 7, elevation: 8, distance: 28, fovY: 50 },
    boat: { pitch: -4, fovY: 55 },
  },
  bloomStrength: 0.35,
  timelapseRate: 1 / 6, // 縮時播放：每秒前進 10 分鐘（小時／秒）
  skyUpdateInterval: 0.15, // 時間改變時重算大氣的最短間隔（秒），拖動滑桿時才不會卡頓
  cloudWindFactor: 2, // 雲層高度的風比海面強，雲飄得比較快
  surfaceDrift: 0.03, // 表層海流約為風速的 3%，泡沫條紋跟著往下風處漂
};

// spray：最多畫幾顆浪花飛沫的粒子
const QUALITY = {
  high: { label: '高', fftSize: 256, grid: [720, 300], maxPixelRatio: 2, spray: 4096 },
  medium: { label: '中', fftSize: 256, grid: [480, 200], maxPixelRatio: 1.5, spray: 2048 },
  low: { label: '低', fftSize: 128, grid: [320, 140], maxPixelRatio: 1, spray: 1024 },
};
const QUALITY_TIERS = ['high', 'medium', 'low'].map((name) => ({ name, maxPixelRatio: QUALITY[name].maxPixelRatio }));
// 自動畫質的起始等級：觸控裝置（手機、平板）從「中」開始
const AUTO_START_TIER = window.matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';

const DEFAULTS = {
  time: 16, // 下午 4 點
  timelapse: false,
  cloudCoverage: 0,
  visibility: 35, // 公里
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
  viewMode: 'orbit',
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

// 環繞中心是浮標中段；船停在預設環繞視角的鏡頭位置，面向浮標
function createRig() {
  const target = [CONFIG.buoyAnchor[0], 1, CONFIG.buoyAnchor[1]];
  const { orbit: o, boat: b } = CONFIG.view;
  const orbit = { yaw: o.yaw * DEG, elevation: o.elevation * DEG, distance: o.distance, fovY: o.fovY * DEG };
  const [x, , z] = orbitPosition(target, orbit);
  const boat = { x, z, yaw: orbit.yaw, pitch: b.pitch * DEG, fovY: b.fovY * DEG };
  return new CameraRig({ target, orbit, boat });
}

function buildPrograms(gl, sources) {
  const fullscreen = (fragment) => new Program(gl, sources['fullscreen.vert'], sources[fragment], fragment);
  return {
    spectrumInit: fullscreen('spectrum-init.frag'),
    spectrumTime: fullscreen('spectrum-time.frag'),
    fft: fullscreen('fft.frag'),
    assemble: fullscreen('assemble.frag'),
    probe: fullscreen('probe.frag'),
    skyTransmittance: fullscreen('sky-transmittance.frag'),
    skyMultiScattering: fullscreen('sky-multiscatter.frag'),
    skyPrecompute: fullscreen('sky-precompute.frag'),
    skyClouds: fullscreen('sky-clouds.frag'),
    sky: fullscreen('sky.frag'),
    ocean: new Program(gl, sources['ocean.vert'], sources['ocean.frag'], 'ocean'),
    buoy: new Program(gl, sources['buoy.vert'], sources['buoy.frag'], 'buoy'),
    sprayUpdate: fullscreen('spray-update.frag'),
    spray: new Program(gl, sources['spray.vert'], sources['spray.frag'], 'spray'),
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
  const sky = new Sky(gl, programs);
  const foamDetail = createFoamDetailTexture(gl);
  const post = new PostProcess(gl, programs);
  const buoy = new Buoy(gl, programs.buoy, { anchor: CONFIG.buoyAnchor });
  const spray = new Spray(gl, programs);
  const camera = createCamera({ fovY: CONFIG.view.orbit.fovY * DEG });
  const rig = createRig();
  const probe = new WaveProbe(gl, programs.probe);
  const audio = new OceanAudio();
  const bell = new BellClapper();
  let lastBuoyWater = null;
  let bellPosition = null;

  // 第一次載入時提示操作方式，使用者開始操作或幾秒後自動淡出；觸控裝置沒有滾輪
  const hint = document.getElementById('hint');
  if (window.matchMedia('(pointer: coarse)').matches) hint.textContent = '拖曳畫面旋轉視角，雙指縮放';
  let hintTimer = null;
  let hintDismissed = false;
  const hideHint = () => {
    hintDismissed = true;
    clearTimeout(hintTimer);
    hint.classList.add('hidden');
  };
  attachCameraInput(canvas, rig, { onInteract: hideHint });

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
      else if (key === 'viewMode') rig.setMode(params.viewMode);
      else if (SEA_STATE_KEYS.includes(key)) seaStateDirty = true;
    },
    onAudioToggle: () => audio.setEnabled(!audio.enabled),
    onResetView: () => rig.reset(),
    onReset() {
      const previousQuality = params.quality;
      Object.assign(params, DEFAULTS);
      seaStateDirty = true;
      audio.setVolume(params.volume);
      rig.resetAll();
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
    audio.setWind(params.windSpeed);
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
      rig,
      getProbe: () => probe.results,
      sky,
      spray,
      audio,
      getEnvironment: () => environment,
      getFrameCount: () => frameCount,
      getTime: () => time, // 動畫時間（秒），例如用來等浮標燈號亮起
      bell,
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

  // 鐘浮標：有新的浮標取樣時更新鐘錘，撞到鐘就合成鐘聲；聲音依鐘與鏡頭的方向、距離調整
  // 鐘錘的模擬很便宜，音效關閉時也照常計算，打開音效時才不會因為狀態中斷而突然猛敲一下
  function updateBell(dt) {
    const water = probe.results[BUOY_PROBE];
    if (water && water !== lastBuoyWater) {
      const pose = buoyPose(CONFIG.buoyAnchor, water);
      bell.addSample(pose);
      bellPosition = pose.center.map((v, i) => v + pose.up[i] * bell.pivotHeight);
      lastBuoyWater = water;
    }
    const strikes = bell.update(dt);
    if (!audio.enabled) return;
    for (const speed of strikes) {
      const toBell = bellPosition.map((v, i) => v - camera.position[i]);
      const distance = Math.hypot(...toBell);
      const side = toBell.reduce((sum, v, i) => sum + v * camera.right[i], 0) / Math.max(distance, 1e-3);
      audio.ringBell(Math.min(Math.max((speed - 0.02) / 0.3, 0), 1), { pan: side * 0.8, distance });
    }
  }

  function applyAdaptiveChange() {
    if (adaptive.tier !== tier) setTier(adaptive.tier);
    resize();
    showPerformance();
  }

  // 時間與天氣：每幀算出太陽、月亮、光源與雲的狀態
  // 大氣貼圖比較耗時，只在時間改變時重算，而且至少間隔 skyUpdateInterval，拖動滑桿時才不會卡頓
  let environment = null;
  let skyTime = null; // 大氣貼圖對應的時間
  let lastSkyUpdate = -Infinity;
  let shownMinute = null;
  const cloudOffset = [0, 0];
  let streakDrift = 0;

  function updateEnvironment(now, dt) {
    if (params.timelapse) {
      params.time = (params.time + dt * CONFIG.timelapseRate) % 24;
      const minute = Math.floor(params.time * 60);
      if (minute !== shownMinute) {
        shownMinute = minute;
        ui.refresh('time');
      }
    }
    const sunDir = sunDirection(params.time);
    const moonDir = moonDirection(params.time);
    if (params.time !== skyTime && now - lastSkyUpdate >= CONFIG.skyUpdateInterval * 1000) {
      sky.precompute(sunDir, moonDir);
      skyTime = params.time;
      lastSkyUpdate = now;
    }
    // 雲順著風向飄，泡沫條紋跟著表層海流往下風處漂（條紋圖樣每 400 公尺重複，取餘數避免數值變大）
    const wind = windVelocity(params.windDirection, params.windSpeed);
    const windDir = windVelocity(params.windDirection, 1);
    cloudOffset[0] += wind[0] * CONFIG.cloudWindFactor * dt;
    cloudOffset[1] += wind[1] * CONFIG.cloudWindFactor * dt;
    streakDrift = (streakDrift + params.windSpeed * CONFIG.surfaceDrift * dt) % 400;
    const haze = hazeDepth(params.visibility);
    environment = {
      ...skyLighting(sunDir, moonDir, haze),
      starRotation: skyRotation(params.time),
      cloudCoverage: params.cloudCoverage,
      cloudThreshold: cloudThreshold(params.cloudCoverage),
      cloudOffset,
      hazeDepth: haze,
      fogDensity: fogDensity(params.visibility),
      wind,
      windDir,
      foamStreaks: foamStreaks(params.windSpeed),
      streakDrift,
    };
    return environment;
  }

  let time = 0;
  let last = performance.now();
  let fpsFrames = 0;
  let fpsElapsed = 0;
  let firstFrame = true;
  let frameCount = 0; // 已畫完的幀數，除錯介面用來等待新的一幀

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

    // 視角：用前幾幀讀回的海面資料（非同步讀回會晚幾幀，鏡頭有平滑所以看不出來）
    const [cameraWater = null, boatWater = null] = probe.results;
    rig.setProbes(cameraWater, boatWater);
    const pose = rig.update(dt, stats.significantHeight);
    camera.position = pose.position;
    camera.yaw = pose.yaw;
    camera.pitch = pose.pitch;
    camera.roll = pose.roll;
    camera.baseFovY = pose.fovY;
    updateCamera(camera, canvas.width / canvas.height);

    simulation.update(time, dt, params.choppiness);
    // 海面取樣：鏡頭、船與浮標的位置（浮標那一欄直接給海面著色器畫倒影與泡沫圈）
    const buoyPoint = { x: CONFIG.buoyAnchor[0], z: CONFIG.buoyAnchor[1], footprint: BUOY_FOOTPRINT };
    probe.sample(simulation, [...rig.probePoints(), buoyPoint]);
    updateBell(dt);

    const env = updateEnvironment(now, dt);
    spray.update({ simulation, camera, deltaTime: dt, wind: env.wind, amount: sprayAmount(params.windSpeed) });
    sky.update(camera, env);
    post.beginScene();
    sky.draw(camera, env, time);
    const shared = { camera, simulation, sky, environment: env, time };
    surface.draw({
      ...shared,
      foamDetail,
      scatterColor: srgbHexToLinear(params.waterColor),
      foamBias: foamBias(params.foam, params.windSpeed),
      maxDistance: CONFIG.maxDistance,
      buoy: {
        probe: probe.texture,
        probeIndex: BUOY_PROBE,
        anchor: CONFIG.buoyAnchor,
        foam: buoyFoamAmount(stats.significantHeight),
        lampIntensity: Buoy.lampIntensity(time),
      },
    });
    buoy.draw({ ...shared, foamDetail, contactFoam: buoyFoamAmount(stats.significantHeight) });
    spray.draw({ ...shared, foamDetail, count: QUALITY[tier].spray });
    post.endScene();
    post.render({ sky: sky.texture, bloomStrength: CONFIG.bloomStrength, time });
    frameCount++;

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
      if (!hintDismissed) {
        hint.classList.remove('hidden');
        hintTimer = setTimeout(hideHint, 6000);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch(showError);
