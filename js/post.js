// HDR 渲染目標（含多重取樣抗鋸齒）、光暈與最終色調映射
import { createTexture, createFramebuffer, deleteTextures, drawFullscreen } from './gl.js';

const BLOOM_LEVELS = 6;

export class PostProcess {
  constructor(gl, programs) {
    this.gl = gl;
    this.programs = programs;
    const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    this.samples = supported && supported.length ? Math.min(4, supported[0]) : 0;
    this.width = 0;
    this.height = 0;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.release();
    const { gl } = this;
    this.width = width;
    this.height = height;

    this.sceneTexture = createTexture(gl, { width, height, internalFormat: gl.RGBA16F });
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    if (this.samples > 1) {
      // 先畫到多重取樣的 renderbuffer，再 resolve 到一般貼圖
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, width, height);
      this.msaaColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA16F, width, height);
      this.msaaFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('多重取樣 framebuffer 不完整');
      }
      this.sceneTarget = createFramebuffer(gl, [this.sceneTexture]);
    } else {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
      this.sceneTarget = createFramebuffer(gl, [this.sceneTexture], this.depth);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.bloom = [];
    let w = width;
    let h = height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      const texture = createTexture(gl, { width: w, height: h, internalFormat: gl.RGBA16F });
      this.bloom.push({ texture, target: createFramebuffer(gl, [texture]) });
      if (w <= 8 || h <= 8) break;
    }
  }

  beginScene() {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.samples > 1 ? this.msaaFbo : this.sceneTarget.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  endScene() {
    const { gl } = this;
    if (this.samples > 1) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.sceneTarget.fbo);
      gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
  }

  // sky 為含雲的天空貼圖，曝光由它的平均亮度決定（見 common.glsl 的 autoExposure）
  render({ sky, bloomStrength, time }) {
    const { gl, programs, bloom } = this;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // 1. 取出高亮部分並縮小
    const first = bloom[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, first.target.fbo);
    gl.viewport(0, 0, first.texture.width, first.texture.height);
    programs.bloomPrefilter.use()
      .tex('u_source', this.sceneTexture, 0)
      .tex('u_sky', sky, 1)
      .set('u_texel', [1 / this.width, 1 / this.height])
      .set('u_threshold', 0.9)
      .set('u_knee', 0.45);
    drawFullscreen(gl);

    // 2. 逐層縮小
    const down = programs.bloomDown.use();
    for (let i = 1; i < bloom.length; i++) {
      const source = bloom[i - 1].texture;
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[i].target.fbo);
      gl.viewport(0, 0, bloom[i].texture.width, bloom[i].texture.height);
      down.tex('u_source', source, 0).set('u_texel', [1 / source.width, 1 / source.height]);
      drawFullscreen(gl);
    }

    // 3. 逐層放大並疊加回上一層
    const up = programs.bloomUp.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = bloom.length - 1; i > 0; i--) {
      const source = bloom[i].texture;
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[i - 1].target.fbo);
      gl.viewport(0, 0, bloom[i - 1].texture.width, bloom[i - 1].texture.height);
      up.tex('u_source', source, 0).set('u_texel', [1 / source.width, 1 / source.height]);
      drawFullscreen(gl);
    }
    gl.disable(gl.BLEND);

    // 4. 合成到畫面
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    programs.composite.use()
      .tex('u_scene', this.sceneTexture, 0)
      .tex('u_bloom', first.texture, 1)
      .tex('u_sky', sky, 2)
      .set('u_bloomStrength', bloomStrength / bloom.length)
      .set('u_time', time);
    drawFullscreen(gl);
  }

  release() {
    const { gl } = this;
    if (!this.sceneTexture) return;
    deleteTextures(gl, [this.sceneTexture, ...this.bloom.map((b) => b.texture)]);
    gl.deleteFramebuffer(this.sceneTarget.fbo);
    for (const b of this.bloom) gl.deleteFramebuffer(b.target.fbo);
    gl.deleteRenderbuffer(this.depth);
    if (this.msaaFbo) {
      gl.deleteFramebuffer(this.msaaFbo);
      gl.deleteRenderbuffer(this.msaaColor);
      this.msaaFbo = null;
    }
    this.sceneTexture = null;
  }
}
