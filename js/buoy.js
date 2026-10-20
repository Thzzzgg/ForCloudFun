// 航道浮標：用旋轉剖面線產生幾何，位置與傾斜由頂點著色器依海面計算
import { setEnvironmentUniforms } from './sky.js';

const SEGMENTS = 36;
const LAMP_BRIGHTNESS = 33; // 燈號亮起時在畫面上的亮度（曝光後），白天夜晚都一樣
export const BUOY_FOOTPRINT = 1.6; // 浮標底面大小：取樣這個範圍的海面平均，過濾掉小波紋

const normalize = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / length);
};

// 浮標吃水線的中心與上方向（與 shaders/buoy.glsl 的 buoyBasis 相同）；water 為海面取樣的結果
export function buoyPose(anchor, { displacement, slope }) {
  const normal = normalize([-slope[0], 1, -slope[1]]);
  const up = normalize([0.85 * normal[0], 0.15 + 0.85 * normal[1], 0.85 * normal[2]]);
  return { center: [anchor[0] + displacement[0], displacement[1], anchor[1] + displacement[2]], up };
}

// 吃水線泡沫的強度（0～1）：浪越大，浮標起伏越劇烈，攪出的泡沫越多；平靜時幾乎沒有
export function buoyFoamAmount(significantHeight) {
  const t = Math.min(Math.max((significantHeight - 0.3) / 2.2, 0), 1);
  return t * t * (3 - 2 * t);
}

const COLORS = {
  hull: [0.03, 0.03, 0.035],    // 水下的防污漆
  red: [0.5, 0.03, 0.02],
  white: [0.75, 0.75, 0.72],
  metal: [0.25, 0.25, 0.26],
  lamp: [0.6, 0.55, 0.4],
};

// 剖面線 (半徑, 高度, 這一段的顏色, 是否發光)，y = 0 為吃水線
const PROFILE = [
  [0.0, -1.6],
  [0.12, -1.6, 'hull'],
  [0.12, -0.6, 'hull'],
  [0.55, -0.45, 'hull'],
  [0.85, -0.2, 'hull'],
  [0.92, 0.0, 'red'],
  [0.92, 0.18, 'red'],
  [0.92, 0.32, 'white'],
  [0.92, 0.42, 'red'],
  [0.8, 0.52, 'red'],
  [0.34, 0.56, 'red'],
  [0.3, 1.0, 'red'],
  [0.26, 1.3, 'white'],
  [0.22, 1.85, 'red'],
  [0.3, 1.88, 'metal'],
  [0.3, 1.94, 'metal'],
  [0.1, 1.96, 'metal'],
  [0.1, 2.22, 'lamp', 1],
  [0.14, 2.24, 'metal'],
  [0.0, 2.3, 'metal'],
];

function buildGeometry() {
  const vertices = [];
  const indices = [];
  for (let p = 1; p < PROFILE.length; p++) {
    const [r0, y0] = PROFILE[p - 1];
    const [r1, y1, colorName, emissive = 0] = PROFILE[p];
    const color = COLORS[colorName];
    // 每一段用自己的法線，讓剖面轉折處保持銳利
    const nl = Math.hypot(y1 - y0, r1 - r0);
    const nr = (y1 - y0) / nl;
    const ny = -(r1 - r0) / nl;
    const base = vertices.length / 10;
    for (let j = 0; j <= SEGMENTS; j++) {
      const angle = (j / SEGMENTS) * Math.PI * 2;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      vertices.push(r0 * c, y0, r0 * s, nr * c, ny, nr * s, ...color, emissive);
      vertices.push(r1 * c, y1, r1 * s, nr * c, ny, nr * s, ...color, emissive);
    }
    for (let j = 0; j < SEGMENTS; j++) {
      const i = base + j * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint16Array(indices) };
}

export class Buoy {
  constructor(gl, program, { anchor }) {
    this.gl = gl;
    this.program = program;
    this.anchor = anchor;
    const { vertices, indices } = buildGeometry();
    this.indexCount = indices.length;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const stride = 10 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 36);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  // 燈號在畫面上的亮度：每 4 秒閃一次（海面的倒影也用它）
  static lampIntensity(time) {
    const phase = time % 4;
    const flash = Math.min(phase / 0.05, 1) * (1 - Math.min(Math.max((phase - 0.45) / 0.1, 0), 1));
    return LAMP_BRIGHTNESS * (0.005 + flash);
  }

  // contactFoam：吃水線泡沫的強度（0～1）
  draw({ camera, simulation, sky, environment, foamDetail, contactFoam, time }) {
    const { gl } = this;
    const program = this.program.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_anchor', this.anchor)
      .set('u_footprint', BUOY_FOOTPRINT)
      .set('u_time', time)
      .set('u_camPos', camera.position)
      .set('u_lampIntensity', Buoy.lampIntensity(time))
      .set('u_contactFoam', contactFoam);
    setEnvironmentUniforms(program, environment);
    const unit = simulation.bindTextures(program, 0);
    program.tex('u_sky', sky.texture, unit).tex('u_foamDetail', foamDetail, unit + 1);

    gl.enable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  dispose() {
    const { gl } = this;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
