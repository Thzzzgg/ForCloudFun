// 海浪頻譜相關的 CPU 端計算：JONSWAP 參數、各層波數分界、統計值與固定的高斯亂數
// 每個頻率格點的頻譜振幅由 GPU 的 spectrum-init.frag 計算

const G = 9.81;
const TWO_PI = Math.PI * 2;
const GAMMA = 3.3; // JONSWAP 尖峰增強係數
const FULLY_DEVELOPED_FETCH = 22000; // 無因次風區超過此值時視為完全發展海況

// 可指定種子的亂數產生器，讓每個頻率格點的隨機相位固定不變
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 依風速與風區長度求 JONSWAP 的 α 與尖峰角頻率
export function jonswapParameters(windSpeed, fetch) {
  const wind = Math.max(windSpeed, 0.5);
  const effectiveFetch = Math.min(fetch, (FULLY_DEVELOPED_FETCH * wind * wind) / G);
  return {
    alpha: 0.076 * ((wind * wind) / (effectiveFetch * G)) ** 0.22,
    omegaPeak: 22 * Math.cbrt((G * G) / (wind * effectiveFetch)),
  };
}

function jonswap(omega, alpha, omegaPeak) {
  const sigma = omega <= omegaPeak ? 0.07 : 0.09;
  const d = omega - omegaPeak;
  const r = Math.exp(-(d * d) / (2 * sigma * sigma * omegaPeak * omegaPeak));
  return (alpha * G * G) / omega ** 5 * Math.exp(-1.25 * (omegaPeak / omega) ** 4) * GAMMA ** r;
}

// 相鄰兩層之間的波數分界：每一層只負責自己那一段波長，避免能量重複計算
export function cascadeBoundaries(size, lengths) {
  const boundaries = [];
  for (let i = 0; i < lengths.length - 1; i++) {
    const nyquist = (Math.PI * size) / lengths[i];
    boundaries.push(Math.min((TWO_PI / lengths[i + 1]) * 6, nyquist * 0.9));
  }
  return boundaries;
}

// 方向分布積分為 1，所以有效波高只需對頻率做一維積分
export function waveStatistics({ windSpeed, fetch, heightScale, kMin, kMax }) {
  const { alpha, omegaPeak } = jonswapParameters(windSpeed, fetch);
  const omegaMin = Math.sqrt(G * kMin);
  const omegaMax = Math.sqrt(G * kMax);
  const steps = 2000;
  const ratio = (omegaMax / omegaMin) ** (1 / steps);
  let variance = 0;
  let omega = omegaMin;
  for (let i = 0; i < steps; i++) {
    const next = omega * ratio;
    variance += jonswap(Math.sqrt(omega * next), alpha, omegaPeak) * (next - omega);
    omega = next;
  }
  return {
    significantHeight: 4 * Math.sqrt(variance) * heightScale,
    peakPeriod: TWO_PI / omegaPeak,
  };
}

// 每層一張 RG32F 高斯亂數紋理 (ξr, ξi)，只在初始化時產生一次
export function gaussianNoise(size, seed) {
  const random = mulberry32(seed);
  const data = new Float32Array(size * size * 2);
  for (let i = 0; i < size * size; i++) {
    const magnitude = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12)));
    const angle = TWO_PI * random();
    data[i * 2] = magnitude * Math.cos(angle);
    data[i * 2 + 1] = magnitude * Math.sin(angle);
  }
  return data;
}
