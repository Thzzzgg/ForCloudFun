// 大氣與天空：太陽與月亮穿過大氣後的光、預先計算的大氣貼圖、每幀合成的含雲天空，以及天空背景
// 大氣散射參考 Bruneton（2017）與 Hillaire（2020）：穿透率與多重散射在載入時先算成查找表
import { createTexture, createFramebuffer, generateMipmaps, drawFullscreen } from './gl.js';

// 大氣參數（長度單位：公里），shader 與 CPU 端共用同一份
const ATMOSPHERE = {
  earthRadius: 6371,
  atmosphereRadius: 6471,
  betaRayleigh: [5.5e-3, 13.0e-3, 22.4e-3],
  betaMie: 10e-3,
  rayleighHeight: 8,
  mieHeight: 1.2,
  mieG: 0.8,
  betaOzone: [0.65e-3, 1.881e-3, 0.085e-3], // 臭氧只吸收不散射，集中在 10～40 公里高
  sunIntensity: 20,
  // 上弦月實際不到太陽的百萬分之一亮，這裡調亮許多，夜晚才看得到月光下的海面
  moonIntensity: 0.03,
  // 沒有月亮時的夜空底光（星光與大氣輝光），為天頂的亮度，接近地平線時較亮
  nightGlow: [2.4e-4, 3.6e-4, 6.4e-4],
};

const SEA_ALTITUDE = 0.02;      // 觀察者在海面上的高度（公里）
const CLOUD_ALTITUDE = 1.5;     // 雲層高度（公里），與 shaders/clouds.glsl 一致
const HORIZON_SOFTNESS = 0.005; // 光源在地平線上下 0.005 弧度內漸漸消失，不會一下子熄滅
// 光源低於地平線約 20° 以上時，視線經過的空氣全都在地球陰影裡，預先計算可以跳過
const DEEP_BELOW_HORIZON = -0.35;

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const scale = (v, s) => v.map((x) => x * s);
const ozoneDensity = (height) => Math.max(1 - Math.abs(height - 25) / 15, 0);

// 從高度 altitude（公里）往 dir 方向穿出大氣層的穿透率（RGB）
// 站得越高，地平線越低（俯角）；光源落到地平線下就被地球擋住
export function transmittance(dir, altitude = SEA_ALTITUDE) {
  const { earthRadius, atmosphereRadius, betaRayleigh, betaMie, betaOzone, rayleighHeight, mieHeight } = ATMOSPHERE;
  const originY = earthRadius + altitude;
  const dip = Math.acos(earthRadius / originY);
  const elevation = Math.asin(Math.min(Math.max(dir[1], -1), 1));
  const visible = smoothstep(-dip - HORIZON_SOFTNESS, -dip + HORIZON_SOFTNESS, elevation);
  if (visible <= 0) return [0, 0, 0];
  // 射線與大氣外緣的交點距離
  const b = originY * dir[1];
  const c = originY * originY - atmosphereRadius * atmosphereRadius;
  const length = -b + Math.sqrt(b * b - c);
  const steps = 64;
  const ds = length / steps;
  let depthRayleigh = 0;
  let depthMie = 0;
  let depthOzone = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const height = Math.hypot(dir[0] * t, originY + dir[1] * t, dir[2] * t) - earthRadius;
    depthRayleigh += Math.exp(-height / rayleighHeight) * ds;
    depthMie += Math.exp(-height / mieHeight) * ds;
    depthOzone += ozoneDensity(height) * ds;
  }
  return betaRayleigh.map((beta, i) => visible
    * Math.exp(-(beta * depthRayleigh + betaMie * 1.1 * depthMie + betaOzone[i] * depthOzone)));
}

// 某個時刻的光源（hazeDepth 為低能見度時多出來的霧，見 js/weather.js）：
// - 海面與浮標：太陽與月亮兩個光源，穿過大氣與霧，在地平線下為 0
// - 雲：雲層高度看到的太陽與月光，方向依亮度加權混合，日落時從太陽平順地轉到月亮
// - 天空背景：太陽圓盤的顏色與月亮圓盤的穿透率（霧由 shader 另外處理）
export function skyLighting(sunDir, moonDir, hazeDepth = 0) {
  const sun = scale(transmittance(sunDir), ATMOSPHERE.sunIntensity);
  const moonTint = transmittance(moonDir);
  // 白天的月光微不足道，略過可以省下海面的雲影計算；太陽接近地平線時才漸漸加入
  const ratio = luminance(sun) / Math.max(luminance(moonTint) * ATMOSPHERE.moonIntensity, 1e-12);
  const moon = scale(moonTint, ATMOSPHERE.moonIntensity * (1 - smoothstep(5, 50, ratio)));
  const haze = (dir) => Math.exp(-hazeDepth / Math.max(dir[1], 0.03));

  const cloudSun = scale(transmittance(sunDir, CLOUD_ALTITUDE), ATMOSPHERE.sunIntensity);
  const cloudMoon = scale(transmittance(moonDir, CLOUD_ALTITUDE), ATMOSPHERE.moonIntensity);
  const sunWeight = luminance(cloudSun);
  const moonWeight = luminance(cloudMoon);
  const blended = sunDir.map((s, i) => s * sunWeight + moonDir[i] * moonWeight);
  const blendedLength = Math.hypot(...blended);
  return {
    sunDir,
    moonDir,
    sunDisc: sun,
    moonTint,
    lightDirs: [...sunDir, ...moonDir],
    lightColors: [...scale(sun, haze(sunDir)), ...scale(moon, haze(moonDir))],
    cloudLightDir: blendedLength > 0 ? scale(blended, 1 / blendedLength) : [0, 1, 0],
    cloudLightColor: cloudSun.map((s, i) => s + cloudMoon[i]),
  };
}

// 把光源、雲與霧的 uniform 設定到 program；shader 沒用到的 uniform 會被略過
// env 由 skyLighting 的結果加上 cloudCoverage、cloudThreshold、cloudOffset、hazeDepth、fogDensity、starRotation 組成
export function setEnvironmentUniforms(program, env) {
  return program
    .set('u_lightDir', env.lightDirs)
    .set('u_lightColor', env.lightColors)
    .set('u_sunDir', env.sunDir)
    .set('u_sunDisc', env.sunDisc)
    .set('u_moonDir', env.moonDir)
    .set('u_moonTint', env.moonTint)
    .set('u_starRotation', env.starRotation)
    .set('u_cloudLightDir', env.cloudLightDir)
    .set('u_cloudLightColor', env.cloudLightColor)
    .set('u_cloudCoverage', env.cloudCoverage)
    .set('u_cloudThreshold', env.cloudThreshold)
    .set('u_cloudOffset', env.cloudOffset)
    .set('u_hazeDepth', env.hazeDepth)
    .set('u_fogDensity', env.fogDensity);
}

function bindTarget(gl, target, texture) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.viewport(0, 0, texture.width, texture.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
}

// shaders/atmosphere.glsl 需要的大氣參數
function setAtmosphereUniforms(program) {
  return program
    .set('u_betaRayleigh', ATMOSPHERE.betaRayleigh)
    .set('u_betaMie', ATMOSPHERE.betaMie)
    .set('u_betaOzone', ATMOSPHERE.betaOzone)
    .set('u_rayleighHeight', ATMOSPHERE.rayleighHeight)
    .set('u_mieHeight', ATMOSPHERE.mieHeight)
    .set('u_mieG', ATMOSPHERE.mieG)
    .set('u_earthRadius', ATMOSPHERE.earthRadius)
    .set('u_atmosphereRadius', ATMOSPHERE.atmosphereRadius);
}

// 畫一個全螢幕的查找表（只用一次，畫完就刪掉 framebuffer）
function renderLookupTable(gl, program, texture, setup) {
  const target = createFramebuffer(gl, [texture]);
  bindTarget(gl, target, texture);
  setup(setAtmosphereUniforms(program.use()));
  drawFullscreen(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(target.fbo);
}

export class Sky {
  constructor(gl, programs, { width = 512, height = 256 } = {}) {
    this.gl = gl;
    this.programs = programs;
    // 穿透率（高度 × 方向）與多重散射（高度 × 太陽角度）查找表，只跟大氣有關，載入時算一次
    this.transmittance = createTexture(gl, { width: 256, height: 64, internalFormat: gl.RGBA16F });
    renderLookupTable(gl, programs.skyTransmittance, this.transmittance, () => {});
    this.multiScattering = createTexture(gl, { width: 32, height: 32, internalFormat: gl.RGBA16F });
    renderLookupTable(gl, programs.skyMultiScattering, this.multiScattering, (program) => {
      program.tex('u_transmittance', this.transmittance, 0);
    });
    const options = { width, height, internalFormat: gl.RGBA16F, wrapS: 'repeat', wrapT: 'clamp', mipmaps: true };
    // 預先計算的大氣（不含雲），太陽或月亮移動時才重算
    this.atmosphere = createTexture(gl, options);
    this.atmosphereTarget = createFramebuffer(gl, [this.atmosphere]);
    // 含雲與霧的天空，每幀合成
    this.cloudSky = createTexture(gl, options);
    this.cloudSkyTarget = createFramebuffer(gl, [this.cloudSky]);
    // 海面反射、環境光、遠處的霧與自動曝光使用的天空貼圖；晴朗時直接用大氣貼圖
    this.texture = this.atmosphere;
  }

  precompute(sunDir, moonDir) {
    const { gl } = this;
    bindTarget(gl, this.atmosphereTarget, this.atmosphere);
    setAtmosphereUniforms(this.programs.skyPrecompute.use())
      .tex('u_transmittance', this.transmittance, 0)
      .tex('u_multiScattering', this.multiScattering, 1)
      .set('u_sunDir', sunDir)
      .set('u_moonDir', moonDir)
      .set('u_sunIntensity', sunDir[1] > DEEP_BELOW_HORIZON ? ATMOSPHERE.sunIntensity : 0)
      .set('u_moonIntensity', moonDir[1] > DEEP_BELOW_HORIZON ? ATMOSPHERE.moonIntensity : 0)
      .set('u_nightGlow', ATMOSPHERE.nightGlow);
    drawFullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    generateMipmaps(gl, this.atmosphere);
  }

  // 每幀合成含雲與霧的天空；沒有雲也沒有額外的霧時直接用大氣貼圖
  update(camera, env) {
    if (env.cloudCoverage <= 0.001 && env.hazeDepth <= 0) {
      this.texture = this.atmosphere;
      return;
    }
    const { gl } = this;
    bindTarget(gl, this.cloudSkyTarget, this.cloudSky);
    const program = this.programs.skyClouds.use()
      .set('u_camPos', camera.position)
      .tex('u_atmosphere', this.atmosphere, 0);
    setEnvironmentUniforms(program, env);
    drawFullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    generateMipmaps(gl, this.cloudSky);
    this.texture = this.cloudSky;
  }

  // 天空背景：以全解析度畫出大氣、星空、月亮、太陽、雲與霧
  draw(camera, env, time) {
    const { gl } = this;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const program = this.programs.sky.use()
      .set('u_camRight', camera.right)
      .set('u_camUp', camera.up)
      .set('u_camForward', camera.forward)
      .set('u_tanHalfFov', camera.tanHalfFov)
      .set('u_camPos', camera.position)
      .set('u_time', time)
      .tex('u_atmosphere', this.atmosphere, 0)
      .tex('u_sky', this.texture, 1);
    setEnvironmentUniforms(program, env);
    drawFullscreen(gl);
    gl.depthMask(true);
  }
}
