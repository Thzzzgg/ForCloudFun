// 浪花飛沫：強風時從碎浪的浪峰噴出、被風吹散的水霧，以 GPU 粒子模擬
// 粒子狀態存在兩張浮點貼圖（位置與年齡、速度與壽命），每幀以全螢幕繪製更新，
// 再用 instancing 把每顆粒子畫成面向鏡頭的方塊
import { createTexture, createFramebuffer, drawFullscreen } from './gl.js';
import { setEnvironmentUniforms } from './sky.js';

const SIDE = 64; // 64 × 64 = 4096 顆粒子
const MAX_LIFE = 3; // 粒子最長的壽命（秒），需與 shaders/spray-update.frag 一致
const SPAWN_MARGIN = 0.2; // 產生範圍比鏡頭的水平視角再寬一點（弧度）

export class Spray {
  constructor(gl, programs) {
    this.gl = gl;
    this.programs = programs;
    const stateTexture = () => createTexture(gl, { width: SIDE, height: SIDE, internalFormat: gl.RGBA32F, filter: 'nearest' });
    this.states = [0, 1].map(() => {
      const position = stateTexture();
      const velocity = stateTexture();
      return { position, velocity, target: createFramebuffer(gl, [position, velocity]) };
    });
    // 一開始全部是死掉的粒子（年齡 1 大於壽命 0）
    for (const state of this.states) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.target.fbo);
      gl.clearBufferfv(gl.COLOR, 0, [0, -100, 0, 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = 0;
    this.seed = 0;
    this.amount = 0;
    this.idle = Infinity; // 不再產生新粒子後經過的時間；超過最長壽命就全部死光，可以略過更新與繪製
    this.vao = gl.createVertexArray();
  }

  get capacity() {
    return SIDE * SIDE;
  }

  get active() {
    return this.idle < MAX_LIFE;
  }

  // amount：飛沫量（0～1）；wind：風速向量 (x, z)（m/s）
  update({ simulation, camera, deltaTime, wind, amount }) {
    this.amount = amount;
    this.idle = amount > 0 ? 0 : this.idle + deltaTime;
    if (!this.active || deltaTime <= 0) return;

    const { gl } = this;
    const source = this.states[this.current];
    const target = this.states[1 - this.current];
    const forward = [camera.forward[0], camera.forward[2]];
    const length = Math.hypot(forward[0], forward[1]) || 1;
    // 鏡頭越高，看得到的海面越遠，產生範圍跟著放大
    const height = Math.max(camera.position[1], 0);
    this.seed = (this.seed + 1) % 16777216;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.target.fbo);
    gl.viewport(0, 0, SIDE, SIDE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const program = this.programs.sprayUpdate.use()
      .tex('u_position', source.position, 0)
      .tex('u_velocity', source.velocity, 1)
      .set('u_deltaTime', deltaTime)
      .set('u_seed', this.seed)
      .set('u_wind', wind)
      .set('u_amount', amount)
      .set('u_camPos', camera.position)
      .set('u_camForward', [forward[0] / length, forward[1] / length])
      .set('u_spawnAngle', Math.atan(camera.tanHalfFov[0]) + SPAWN_MARGIN)
      .set('u_spawnRange', [Math.max(15, height * 0.5), Math.max(140, height * 3)]);
    simulation.bindTextures(program, 2);
    drawFullscreen(gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = 1 - this.current;
  }

  // 在海面與浮標之後繪製：做深度測試但不寫入深度，以預乘 alpha 混合；count 為最多畫幾顆
  draw({ camera, sky, environment, foamDetail, count }) {
    if (!this.active) return;
    const { gl } = this;
    const state = this.states[this.current];
    const program = this.programs.spray.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_camPos', camera.position)
      .set('u_camRight', camera.right)
      .set('u_camUp', camera.up)
      .set('u_amount', this.amount)
      .tex('u_position', state.position, 0)
      .tex('u_velocity', state.velocity, 1)
      .tex('u_sky', sky.texture, 2)
      .tex('u_foamDetail', foamDetail, 3);
    setEnvironmentUniforms(program, environment);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(count, this.capacity));
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}
