// 海浪頻譜相關的 CPU 端計算：JONSWAP 參數、各層波數分界、統計值與固定的高斯亂數
// 每個頻率格點的頻譜振幅由 GPU 的 spectrum-init.frag 計算（常數需與該檔一致）

const G = 9.81;
const TWO_PI = Math.PI * 2;
const GAMMA = 3.3; // 風浪的 JONSWAP 尖峰增強係數
const SWELL_GAMMA = 7; // 湧浪的頻譜更窄，波形更規律
const FULLY_DEVELOPED_FETCH = 22000; // 無因次風區超過此值時視為完全發展海況
export const SWELL_SPREAD = 40; // 湧浪方向分布 cos^(2s)(θ/2) 的 s，越大波峰越長、方向越集中

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

function jonswap(omega, alpha, omegaPeak, gamma) {
  const sigma = omega <= omegaPeak ? 0.07 : 0.09;
  const d = omega - omegaPeak;
  const r = Math.exp(-(d * d) / (2 * sigma * sigma * omegaPeak * omegaPeak));
  return (alpha * G * G) / omega ** 5 * Math.exp(-1.25 * (omegaPeak / omega) ** 4) * gamma ** r;
}

// 在對數間距的頻率格點上積分，回傳變異數與頻譜密度最大處的角頻率
function integrate(spectrum, omegaMin, omegaMax, steps = 2000) {
  const ratio = (omegaMax / omegaMin) ** (1 / steps);
  let variance = 0;
  let peak = { density: -1, omega: omegaMin };
  let omega = omegaMin;
  for (let i = 0; i < steps; i++) {
    const next = omega * ratio;
    const center = Math.sqrt(omega * next);
    const density = spectrum(center);
    variance += density * (next - omega);
    if (density > peak.density) peak = { density, omega: center };
    omega = next;
  }
  return { variance, peakOmega: peak.omega };
}

// 湧浪採尖峰較窄的 JONSWAP 形狀，α 依目標有效波高換算（有效波高 = 4√變異數）
export function swellParameters(height, period) {
  const omegaPeak = TWO_PI / period;
  if (height <= 0) return { alpha: 0, omegaPeak };
  const { variance } = integrate((omega) => jonswap(omega, 1, omegaPeak, SWELL_GAMMA), omegaPeak * 0.3, omegaPeak * 8);
  return { alpha: (height / 4) ** 2 / variance, omegaPeak };
}

// 湧浪方向分布 cos^(2s)(θ/2) 在 [-π, π] 積分為 1 所需的係數
export function swellSpreadNormalization(spread) {
  const steps = 4000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const theta = -Math.PI + ((i + 0.5) / steps) * TWO_PI;
    sum += Math.abs(Math.cos(theta / 2)) ** (2 * spread);
  }
  return 1 / ((sum * TWO_PI) / steps);
}

// 相鄰兩層之間的波數分界：每一層只負責自己那一段波長，避免能量重複計算
// cascades：由大到小 [{ length, maxWavelength }]，maxWavelength 是該層負責的最長波長
export function cascadeBoundaries(size, cascades) {
  const boundaries = [];
  for (let i = 0; i < cascades.length - 1; i++) {
    const nyquist = (Math.PI * size) / cascades[i].length;
    boundaries.push(Math.min(TWO_PI / cascades[i + 1].maxWavelength, nyquist * 0.9));
  }
  return boundaries;
}

// 方向分布積分為 1，所以有效波高只需對頻率做一維積分；風浪與湧浪互相獨立，變異數直接相加
// 尖峰週期取合併後頻譜密度最大的頻率（湧浪較強時就是湧浪的週期）
export function waveStatistics({ windSpeed, fetch, heightScale, swellHeight = 0, swellPeriod = 12, kMin, kMax }) {
  const wind = jonswapParameters(windSpeed, fetch);
  const swell = swellParameters(swellHeight, swellPeriod);
  const spectrum = (omega) => heightScale * heightScale * jonswap(omega, wind.alpha, wind.omegaPeak, GAMMA)
    + (swell.alpha > 0 ? jonswap(omega, swell.alpha, swell.omegaPeak, SWELL_GAMMA) : 0);
  const { variance, peakOmega } = integrate(spectrum, Math.sqrt(G * kMin), Math.sqrt(G * kMax));
  return {
    significantHeight: 4 * Math.sqrt(variance),
    peakPeriod: TWO_PI / peakOmega,
  };
}

// 每層一張 RGBA32F 亂數紋理，只在初始化時產生一次：每個頻率格點兩組互相獨立的複數高斯亂數
// xy 給風浪使用；zw 只取相位給湧浪使用（湧浪成分很少，固定振幅才能讓畫面浪高符合設定）
export function gaussianNoise(size, seed) {
  const random = mulberry32(seed);
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size * 2; i++) {
    const magnitude = Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12)));
    const angle = TWO_PI * random();
    data[i * 2] = magnitude * Math.cos(angle);
    data[i * 2 + 1] = magnitude * Math.sin(angle);
  }
  return data;
}
