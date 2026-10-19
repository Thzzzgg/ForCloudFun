// 大氣與天空：預先計算天空貼圖、計算穿過大氣後的太陽光顏色、繪製天空背景
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
  sunIntensity: 20,
};

export function sunDirection(elevationDeg, azimuthDeg) {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

// 太陽光穿過大氣後的強度與顏色（低角度時偏暖）
export function sunColor(sunDir) {
  const { earthRadius, atmosphereRadius, betaRayleigh, betaMie, rayleighHeight, mieHeight, sunIntensity } = ATMOSPHERE;
  const originY = earthRadius + 0.02;
  // 射線與大氣外緣的交點距離
  const b = originY * sunDir[1];
  const c = originY * originY - atmosphereRadius * atmosphereRadius;
  const length = -b + Math.sqrt(b * b - c);
  const steps = 64;
  const ds = length / steps;
  let depthRayleigh = 0;
  let depthMie = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const x = sunDir[0] * t;
    const y = originY + sunDir[1] * t;
    const z = sunDir[2] * t;
    const height = Math.hypot(x, y, z) - earthRadius;
    depthRayleigh += Math.exp(-height / rayleighHeight) * ds;
    depthMie += Math.exp(-height / mieHeight) * ds;
  }
  return betaRayleigh.map((beta) => sunIntensity * Math.exp(-(beta * depthRayleigh + betaMie * 1.1 * depthMie)));
}

export class Sky {
  constructor(gl, programs, { width = 512, height = 256 } = {}) {
    this.gl = gl;
    this.programs = programs;
    this.texture = createTexture(gl, {
      width, height, internalFormat: gl.RGBA16F, wrapS: 'repeat', wrapT: 'clamp', mipmaps: true,
    });
    this.target = createFramebuffer(gl, [this.texture]);
  }

  precompute(sunDir) {
    const { gl, texture } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, texture.width, texture.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    this.programs.skyPrecompute.use()
      .set('u_sunDir', sunDir)
      .set('u_betaRayleigh', ATMOSPHERE.betaRayleigh)
      .set('u_betaMie', ATMOSPHERE.betaMie)
      .set('u_rayleighHeight', ATMOSPHERE.rayleighHeight)
      .set('u_mieHeight', ATMOSPHERE.mieHeight)
      .set('u_mieG', ATMOSPHERE.mieG)
      .set('u_earthRadius', ATMOSPHERE.earthRadius)
      .set('u_atmosphereRadius', ATMOSPHERE.atmosphereRadius)
      .set('u_sunIntensity', ATMOSPHERE.sunIntensity);
    drawFullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    generateMipmaps(gl, texture);
  }

  draw(camera, sunDir, sunRadiance) {
    const { gl } = this;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.programs.sky.use()
      .set('u_camRight', camera.right)
      .set('u_camUp', camera.up)
      .set('u_camForward', camera.forward)
      .set('u_tanHalfFov', camera.tanHalfFov)
      .set('u_sunDir', sunDir)
      .set('u_sunColor', sunRadiance)
      .tex('u_sky', this.texture, 0);
    drawFullscreen(gl);
    gl.depthMask(true);
  }
}
