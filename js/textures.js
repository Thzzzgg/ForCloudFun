// 程序產生的泡沫細節紋理（可無縫拼接）
// R：Worley 噪音的 F2 - F1 形成的泡沫網狀紋路；G：值噪音碎形，增加變化
import { createTexture, generateMipmaps } from './gl.js';

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 週期為 cells 的 Worley 噪音，回傳 F2 - F1
function worleyEdge(u, v, cells, seed) {
  const px = u * cells;
  const py = v * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox;
      const gy = cy + oy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      const fx = gx + hash(wx, wy, seed);
      const fy = gy + hash(wx, wy, seed + 1);
      const d = Math.hypot(fx - px, fy - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return f2 - f1;
}

// 週期為 cells 的平滑值噪音
function valueNoise(u, v, cells, seed) {
  const px = u * cells;
  const py = v * cells;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const tx = px - x0;
  const ty = py - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const at = (x, y) => hash(((x % cells) + cells) % cells, ((y % cells) + cells) % cells, seed);
  const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
  const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function createFoamDetailTexture(gl, size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const lace = (1 - smoothstep(0.0, 0.22, worleyEdge(u, v, 10, 11))) * 0.65
        + (1 - smoothstep(0.0, 0.18, worleyEdge(u, v, 23, 29))) * 0.35;
      let fractal = 0;
      let amplitude = 0.5;
      for (let octave = 0; octave < 4; octave++) {
        const cells = 4 << octave;
        fractal += valueNoise(u, v, cells, 101 + octave) * amplitude;
        amplitude *= 0.5;
      }
      const i = (y * size + x) * 4;
      data[i] = Math.round(Math.min(lace * 0.75 + fractal * 0.5, 1) * 255);
      data[i + 1] = Math.round(Math.min(fractal / 0.9375, 1) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const texture = createTexture(gl, {
    width: size, height: size, internalFormat: gl.RGBA8, wrap: 'repeat', mipmaps: true, anisotropy: true,
  });
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, data);
  generateMipmaps(gl, texture);
  return texture;
}
