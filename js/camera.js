// 固定視角的攝影機：矩陣採 column-major，與 WebGL 相同

const DEG = Math.PI / 180;

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function createCamera({ pitch, fovY, near = 0.5, far = 40000 }) {
  return { position: [0, 5, 0], yaw: 0, pitch: pitch * DEG, baseFovY: fovY * DEG, near, far };
}

export function updateCamera(camera, aspect) {
  // 直式螢幕時加大垂直視角，維持足夠的水平視野
  const fovY = aspect >= 1
    ? camera.baseFovY
    : Math.min(2 * Math.atan(Math.tan(camera.baseFovY / 2) / aspect ** 0.7), 80 * DEG);
  // 直式螢幕時鏡頭稍微往下，讓海面佔多一點畫面
  const pitch = camera.pitch - 4 * DEG * Math.min(Math.max((1 - aspect) / 0.45, 0), 1);
  const { yaw, position: eye, near, far } = camera;
  const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);

  const view = new Float32Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
  ]);
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const projection = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);

  camera.forward = forward;
  camera.right = right;
  camera.up = up;
  camera.tanHalfFov = [Math.tan(fovY / 2) * aspect, Math.tan(fovY / 2)];
  camera.viewProjection = multiply(projection, view);
  return camera;
}

// 世界座標點投影到畫面上的 NDC y 座標
export function projectNdcY(camera, point) {
  const m = camera.viewProjection;
  const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
  return y / w;
}
