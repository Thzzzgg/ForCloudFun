// 點擊水面：在 GPU 上找出點到的海面位置，在那裡濺起水花、泛起漣漪、留下一團泡沫
// 拾取（shaders/pick.frag）和海面取樣一樣用 PBO 搭配 fence 非同步讀回，晚幾幀才濺起水花，畫面不會卡頓
import { createTexture, createFramebuffer, deleteTextures, drawFullscreen } from './gl.js';
import { setEnvironmentUniforms } from './sky.js';
import { Droplets, MAX_DROPLETS, Ripples, RIPPLE_DEPTH } from './ripples.js';

const FLOATS_PER_DROPLET = 8; // (x, y, z, 半徑), (vx, vy, vz, 不透明度)

export class Splashes {
  constructor(gl, programs) {
    this.gl = gl;
    this.programs = programs;
    this.texture = createTexture(gl, { width: 1, height: 1, internalFormat: gl.RGBA32F, filter: 'nearest' });
    this.target = createFramebuffer(gl, [this.texture]);
    this.requests = []; // 等下一次更新時送出的拾取：{ origin, direction, strength }
    this.pending = []; // 已送出、等讀回的拾取（依送出順序）
    this.result = new Float32Array(4);
    this.ripples = new Ripples();
    this.droplets = new Droplets(MAX_DROPLETS);
    this.instances = new Float32Array(MAX_DROPLETS * FLOATS_PER_DROPLET);
    this.instanceCount = 0;

    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instances.byteLength, gl.DYNAMIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    for (const location of [0, 1]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 4, gl.FLOAT, false, FLOATS_PER_DROPLET * 4, location * 16);
      gl.vertexAttribDivisor(location, 1);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // 沿著從 origin 往 direction（單位向量）的視線找海面；下一次 update 時送到 GPU，幾幀後濺起水花
  // strength 為水花的大小（1 為一般大小）
  pick(origin, direction, strength = 1) {
    this.requests.push({ origin: [...origin], direction: [...direction], strength });
  }

  // 每幀在海浪模擬更新之後呼叫：收回拾取結果並濺起水花、送出新的拾取、移動水花粒子
  // 回傳這一幀濺起的水花 [{ position: [x, y, z], strength }]，例如用來播放落水聲
  update({ simulation, time, deltaTime }) {
    const splashes = this.collect(time);
    for (const request of this.requests) this.send(simulation, request);
    this.requests = [];
    this.droplets.update(deltaTime);
    this.instanceCount = this.droplets.pack(this.instances);
    return splashes;
  }

  send(simulation, request) {
    const { gl } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, 1, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const program = this.programs.pick.use()
      .set('u_origin', request.origin)
      .set('u_direction', request.direction);
    simulation.bindTextures(program, 0);
    drawFullscreen(gl);
    // 點擊很少發生，每次拾取各用一個緩衝區，讀回後就刪掉
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.result.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.pending.push({ ...request, buffer, fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) });
    gl.flush();
  }

  // 依送出順序取回已完成的拾取；碰到海面的就濺起水花
  collect(time) {
    const { gl } = this;
    const splashes = [];
    while (this.pending.length) {
      const pick = this.pending[0];
      const status = gl.clientWaitSync(pick.fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) break;
      this.pending.shift();
      gl.deleteSync(pick.fence);
      if (status !== gl.WAIT_FAILED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pick.buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.result);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const [restX, restZ, height, distance] = this.result;
        if (distance > 0) {
          const position = [pick.origin[0] + pick.direction[0] * distance, height, pick.origin[2] + pick.direction[2] * distance];
          // 漣漪用海面的靜止座標，才會跟著浪起伏；水花粒子則在實際的落水點
          this.ripples.add(restX, restZ, time, RIPPLE_DEPTH * pick.strength);
          this.droplets.spawn(position, { strength: pick.strength });
          splashes.push({ position, strength: pick.strength });
        }
      }
      gl.deleteBuffer(pick.buffer);
    }
    return splashes;
  }

  // 傳給海面著色器的漣漪：{ data, count }
  rippleUniforms(time) {
    return this.ripples.pack(time);
  }

  // 在海面與浮標之後繪製：做深度測試但不寫入深度，以預乘 alpha 混合
  // viewportHeight 為渲染目標的高度（像素），用來讓太小的水滴至少畫成一個像素
  draw({ camera, sky, environment, viewportHeight }) {
    if (!this.instanceCount) return;
    const { gl } = this;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instances, 0, this.instanceCount * FLOATS_PER_DROPLET);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const program = this.programs.splash.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_camPos', camera.position)
      .set('u_camRight', camera.right)
      .set('u_pixelAngle', (2 * camera.tanHalfFov[1]) / viewportHeight)
      .tex('u_sky', sky.texture, 0);
    setEnvironmentUniforms(program, environment);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.instanceCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  dispose() {
    const { gl } = this;
    for (const pick of this.pending) {
      gl.deleteSync(pick.fence);
      gl.deleteBuffer(pick.buffer);
    }
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.vao);
    deleteTextures(gl, [this.texture]);
    gl.deleteFramebuffer(this.target.fbo);
  }
}
