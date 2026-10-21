// 海面網格與繪製：網格固定在螢幕空間，由頂點著色器投射到海平面
import { horizonNdcTop } from './camera.js';
import { setEnvironmentUniforms } from './sky.js';

const GRID_X_EXTENT = 1.5;    // 左右延伸到畫面外（NDC）
const GRID_BOTTOM = -3.0;     // 往下延伸到畫面外，避免浪峰抬高時露出網格邊緣
const GRID_BOTTOM_SHARE = 0.12;

export class OceanSurface {
  constructor(gl, program, { columns, rows }) {
    this.gl = gl;
    this.program = program;
    this.columns = columns;
    this.rows = rows;

    const vertices = new Float32Array(columns * rows * 2);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const i = (y * columns + x) * 2;
        vertices[i] = x / (columns - 1);
        vertices[i + 1] = y / (rows - 1);
      }
    }
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    let n = 0;
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < columns - 1; x++) {
        const i = y * columns + x;
        indices.set([i, i + 1, i + columns, i + 1, i + columns + 1, i + columns], n);
        n += 6;
      }
    }
    this.indexCount = indices.length;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  // buoy：{ probe, probeIndex, anchor, foam, lampIntensity }，浮標的倒影與吃水線泡沫圈用
  // ripples：{ data, count }，點擊水面產生的漣漪（js/ripples.js 的 Ripples.pack）
  draw({ camera, simulation, sky, environment, foamDetail, scatterColor, foamBias, maxDistance, buoy, ripples, time }) {
    const { gl } = this;
    // 網格頂端對齊地平線在畫面上的位置（畫面傾斜時取最高點）
    // 往上看時地平線可能在畫面下方，往下看時則在畫面上方之外，都要限制在合理範圍
    const top = Math.min(Math.max(horizonNdcTop(camera, GRID_X_EXTENT) + 0.02, -1), 1.2);

    const program = this.program.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_camPos', camera.position)
      .set('u_camRight', camera.right)
      .set('u_camUp', camera.up)
      .set('u_camForward', camera.forward)
      .set('u_tanHalfFov', camera.tanHalfFov)
      .set('u_gridMap', [GRID_X_EXTENT, GRID_BOTTOM, top, GRID_BOTTOM_SHARE])
      .set('u_gridStep', [1 / (this.columns - 1), 1 / (this.rows - 1)])
      .set('u_maxDistance', maxDistance)
      .set('u_scatterColor', scatterColor)
      .set('u_foamBias', foamBias)
      .set('u_roughness', 0.045)
      .set('u_buoyProbe', buoy.probeIndex)
      .set('u_buoyAnchor', buoy.anchor)
      .set('u_buoyFoam', buoy.foam)
      .set('u_lampIntensity', buoy.lampIntensity)
      .set('u_ripples', ripples.data)
      .set('u_rippleCount', ripples.count)
      .set('u_time', time);
    setEnvironmentUniforms(program, environment);
    const unit = simulation.bindTextures(program, 0);
    program
      .tex('u_sky', sky.texture, unit)
      .tex('u_foamDetail', foamDetail, unit + 1)
      .tex('u_probe', buoy.probe, unit + 2);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
