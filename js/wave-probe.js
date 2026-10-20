// 非同步讀回 GPU 上的海面高度與坡度：先畫到一張小貼圖，再用 PBO 搭配 fence 在之後幾幀取回，
// 不會讓 GPU 停下來等 CPU（直接 readPixels 會造成卡頓）
import { createTexture, createFramebuffer, deleteTextures, drawFullscreen } from './gl.js';

const MAX_POINTS = 4; // 需與 shaders/probe.frag 一致
const RING_SIZE = 3; // 同時在路上的讀取數量

export class WaveProbe {
  constructor(gl, program) {
    this.gl = gl;
    this.program = program;
    this.texture = createTexture(gl, { width: MAX_POINTS, height: 2, internalFormat: gl.RGBA32F, filter: 'nearest' });
    this.target = createFramebuffer(gl, [this.texture]);
    // 緩衝區第一次使用時才配置：先配置好但還沒用到的緩衝區，會讓 Chrome 誤判讀回流程而放棄最佳化
    this.slots = Array.from({ length: RING_SIZE }, () => ({ buffer: gl.createBuffer(), allocated: false, fence: null, serial: 0 }));
    this.serial = 0;
    this.points = new Float32Array(MAX_POINTS * 3);
    this.data = new Float32Array(MAX_POINTS * 2 * 4);
    // 最近一次讀回的結果：[{ displacement: [x, y, z], slope: [∂h/∂x, ∂h/∂z] }]，尚未讀回時為空陣列
    this.results = [];
    // 這份結果是在哪個動畫時間取樣的（讀回會晚幾幀，而且不一定每幀都有）
    this.resultsTime = 0;
  }

  // points：[{ x, z, footprint }]，最多 MAX_POINTS 個；time 為目前的動畫時間；每幀呼叫一次
  sample(simulation, points, time = 0) {
    const { gl } = this;
    this.collect();
    const slot = this.slots.find((s) => !s.fence);
    if (!slot) return;

    this.points.fill(0);
    points.slice(0, MAX_POINTS).forEach((p, i) => this.points.set([p.x, p.z, p.footprint], i * 3));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(0, 0, MAX_POINTS, 2);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const program = this.program.use().set('u_points', this.points);
    simulation.bindTextures(program, 0);
    drawFullscreen(gl);

    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
    if (!slot.allocated) {
      gl.bufferData(gl.PIXEL_PACK_BUFFER, MAX_POINTS * 2 * 4 * 4, gl.STREAM_READ);
      slot.allocated = true;
    }
    gl.readPixels(0, 0, MAX_POINTS, 2, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.serial = ++this.serial;
    slot.count = Math.min(points.length, MAX_POINTS);
    slot.time = time;
    gl.flush();
  }

  // 依送出順序取回已完成的讀取，較新的結果覆蓋較舊的
  collect() {
    const { gl } = this;
    const pending = this.slots.filter((s) => s.fence).sort((a, b) => a.serial - b.serial);
    for (const slot of pending) {
      const status = gl.clientWaitSync(slot.fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) break;
      gl.deleteSync(slot.fence);
      slot.fence = null;
      if (status === gl.WAIT_FAILED) continue;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.resultsTime = slot.time;
      this.results = Array.from({ length: slot.count }, (_, i) => {
        const d = i * 4;
        const n = (MAX_POINTS + i) * 4;
        // 和海面著色相同的坡度算法：水平位移造成的壓縮會讓坡度變陡
        return {
          displacement: [this.data[d], this.data[d + 1], this.data[d + 2]],
          slope: [
            this.data[n] / Math.max(1 + this.data[n + 2], 0.25),
            this.data[n + 1] / Math.max(1 + this.data[n + 3], 0.25),
          ],
        };
      });
    }
  }

  dispose() {
    const { gl } = this;
    for (const slot of this.slots) {
      if (slot.fence) gl.deleteSync(slot.fence);
      gl.deleteBuffer(slot.buffer);
    }
    deleteTextures(gl, [this.texture]);
    gl.deleteFramebuffer(this.target.fbo);
  }
}
