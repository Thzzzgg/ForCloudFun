// GPU 上的 FFT 海洋模擬：多層不同尺度的海面區塊（cascade）疊加，避免看出重複的圖樣
import { createTexture, createFramebuffer, generateMipmaps, deleteTextures, drawFullscreen } from './gl.js';
import {
  cascadeBoundaries, gaussianNoise, jonswapParameters, swellParameters, swellSpreadNormalization, SWELL_SPREAD,
} from './spectrum.js';

// 頻率量化成基頻的整數倍，動畫每 1000 秒無縫循環，也避免長時間後浮點精度不足
export const LOOP_PERIOD = 1000;
const OMEGA0 = (2 * Math.PI) / LOOP_PERIOD;
const FOAM_RECOVERY = 0.3;
const SWELL_SPREAD_NORM = swellSpreadNormalization(SWELL_SPREAD);

// 面板的方向（0 = 往畫面遠方，順時針增加）換算成 xz 平面上的角度
function planeAngle(direction) {
  return Math.atan2(-Math.cos(direction), Math.sin(direction));
}

export class OceanSimulation {
  // cascades：由大到小 [{ length, maxWavelength }]
  constructor(gl, programs, { size, cascades }) {
    this.gl = gl;
    this.programs = programs;
    this.size = size;
    const lengths = cascades.map((c) => c.length);
    this.lengths = lengths;
    this.maxLod = Math.log2(size);

    const boundaries = cascadeBoundaries(size, cascades);
    this.kMin = (2 * Math.PI) / lengths[0];
    this.kMax = (Math.PI * size) / lengths[lengths.length - 1];

    // FFT 計算用的 ping-pong 緩衝（所有層共用）
    const fftTexture = () => createTexture(gl, { width: size, height: size, internalFormat: gl.RGBA32F, filter: 'nearest' });
    this.fft = [0, 1].map(() => {
      const a = fftTexture();
      const b = fftTexture();
      return { a, b, target: createFramebuffer(gl, [a, b]) };
    });

    const outputTexture = () => createTexture(gl, {
      width: size, height: size, internalFormat: gl.RGBA16F, wrap: 'repeat', mipmaps: true, anisotropy: true,
    });
    this.cascades = lengths.map((length, i) => {
      const noise = createTexture(gl, { width: size, height: size, internalFormat: gl.RGBA32F, filter: 'nearest' });
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.FLOAT, gaussianNoise(size, 1 + i * 7919));
      const h0 = createTexture(gl, { width: size, height: size, internalFormat: gl.RGBA32F, filter: 'nearest' });
      const displacement = [outputTexture(), outputTexture()];
      const derivatives = outputTexture();
      const slopeVariance = outputTexture();
      return {
        length,
        kMin: i === 0 ? 0 : boundaries[i - 1],
        kMax: i === lengths.length - 1 ? 1e9 : boundaries[i],
        noise,
        h0,
        h0Target: createFramebuffer(gl, [h0]),
        displacement,
        derivatives,
        slopeVariance,
        targets: displacement.map((d) => createFramebuffer(gl, [d, derivatives, slopeVariance])),
      };
    });

    // 紊流值預設為 1（平靜海面），避免一開始滿是泡沫
    for (const cascade of this.cascades) {
      for (const target of cascade.targets) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
        gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
        gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0]);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = 0;
  }

  // 海況參數改變時重新產生初始頻譜（GPU 上一次繪製即可完成）；方向的單位是弧度
  setSeaState({ windSpeed, windDirection, heightScale, fetch, swellHeight, swellDirection, swellPeriod }) {
    const { gl, size } = this;
    const wind = jonswapParameters(windSpeed, fetch);
    const swell = swellParameters(swellHeight, swellPeriod);
    const program = this.programs.spectrumInit.use();
    program
      .set('u_size', size)
      .set('u_alpha', wind.alpha)
      .set('u_omegaPeak', wind.omegaPeak)
      .set('u_windAngle', planeAngle(windDirection))
      .set('u_heightScale', heightScale)
      .set('u_swellAlpha', swell.alpha)
      .set('u_swellOmegaPeak', swell.omegaPeak)
      .set('u_swellAngle', planeAngle(swellDirection))
      .set('u_swellSpread', SWELL_SPREAD)
      .set('u_swellSpreadNorm', SWELL_SPREAD_NORM);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, size, size);
    for (const cascade of this.cascades) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, cascade.h0Target.fbo);
      program
        .tex('u_noise', cascade.noise, 0)
        .set('u_length', cascade.length)
        .set('u_kMin', cascade.kMin)
        .set('u_kMax', cascade.kMax);
      drawFullscreen(gl);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  update(time, deltaTime, choppiness) {
    const { gl, programs, size } = this;
    const next = 1 - this.current;
    const loopTime = time % LOOP_PERIOD;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, size, size);

    for (const cascade of this.cascades) {
      // 1. 頻譜隨時間演進
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fft[0].target.fbo);
      programs.spectrumTime.use()
        .tex('u_h0', cascade.h0, 0)
        .set('u_time', loopTime)
        .set('u_length', cascade.length)
        .set('u_size', size)
        .set('u_omega0', OMEGA0);
      drawFullscreen(gl);

      // 2. 二維逆向 FFT：先水平再垂直
      let source = 0;
      const fft = programs.fft.use().set('u_size', size);
      for (const horizontal of [1, 0]) {
        for (let subSize = 2; subSize <= size; subSize *= 2) {
          const destination = 1 - source;
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fft[destination].target.fbo);
          fft
            .tex('u_inputA', this.fft[source].a, 0)
            .tex('u_inputB', this.fft[source].b, 1)
            .set('u_subSize', subSize)
            .set('u_horizontal', horizontal);
          drawFullscreen(gl);
          source = destination;
        }
      }

      // 3. 整理成位移、導數與坡度變異數貼圖
      gl.bindFramebuffer(gl.FRAMEBUFFER, cascade.targets[next].fbo);
      programs.assemble.use()
        .tex('u_fieldA', this.fft[source].a, 0)
        .tex('u_fieldB', this.fft[source].b, 1)
        .tex('u_prevDisplacement', cascade.displacement[this.current], 2)
        .set('u_choppiness', choppiness)
        .set('u_deltaTime', deltaTime)
        .set('u_foamRecovery', FOAM_RECOVERY);
      drawFullscreen(gl);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      generateMipmaps(gl, cascade.displacement[next]);
      generateMipmaps(gl, cascade.derivatives);
      generateMipmaps(gl, cascade.slopeVariance);
    }
    this.current = next;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // 繪製海面或浮標時，把各層的貼圖依序綁到從 firstUnit 開始的貼圖單元，回傳下一個可用的單元
  bindTextures(program, firstUnit) {
    const count = this.cascades.length;
    this.cascades.forEach((cascade, i) => {
      program
        .tex(`u_displacement${i}`, cascade.displacement[this.current], firstUnit + i)
        .tex(`u_derivatives${i}`, cascade.derivatives, firstUnit + count + i)
        .tex(`u_slopeVariance${i}`, cascade.slopeVariance, firstUnit + 2 * count + i);
    });
    program
      .set('u_lengths', this.lengths)
      .set('u_texSize', this.size)
      .set('u_maxLod', this.maxLod);
    return firstUnit + 3 * count;
  }

  dispose() {
    const { gl } = this;
    for (const f of this.fft) {
      deleteTextures(gl, [f.a, f.b]);
      gl.deleteFramebuffer(f.target.fbo);
    }
    for (const c of this.cascades) {
      deleteTextures(gl, [c.noise, c.h0, ...c.displacement, c.derivatives, c.slopeVariance]);
      gl.deleteFramebuffer(c.h0Target.fbo);
      for (const t of c.targets) gl.deleteFramebuffer(t.fbo);
    }
  }
}
