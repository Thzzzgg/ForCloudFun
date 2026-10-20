// 強風與暴風的效果強度（不依賴 WebGL）
// 蒲福 7 級（約 14 m/s）起，泡沫開始沿風向拉成條紋、浪頭噴出飛沫；到 10 級（約 25 m/s）海面一片白

const DEG = Math.PI / 180;

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

// 沿風向的泡沫條紋（0～1）
export function foamStreaks(windSpeed) {
  return smoothstep(12, 22, windSpeed);
}

// 浪頭被風吹起的飛沫（0～1）
export function sprayAmount(windSpeed) {
  return smoothstep(14, 24, windSpeed);
}

// 風速向量 (x, z)（m/s）：方向與浪前進的方向相同，0° 朝向遠方（-z），順時針增加
export function windVelocity(directionDeg, speed) {
  const angle = directionDeg * DEG;
  return [Math.sin(angle) * speed, -Math.cos(angle) * speed];
}
