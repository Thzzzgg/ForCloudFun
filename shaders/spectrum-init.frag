#version 300 es
// 產生初始頻譜 h0(k)：(風浪 + 湧浪) 的方向頻譜 × 固定的高斯亂數
// 風浪：JONSWAP × Donelan-Banner 方向分布；湧浪：尖峰較窄的 JONSWAP × cos^(2s) 方向分布
// 輸出 (h0(k), conj(h0(-k)))，只在海況參數改變時執行；常數需與 js/spectrum.js 一致
precision highp float;
precision highp sampler2D;

uniform sampler2D u_noise;   // 每個頻率格點固定的兩組複數高斯亂數：xy 給風浪，zw 給湧浪
uniform float u_size;        // FFT 尺寸 N
uniform float u_length;      // 此層海面區塊邊長（公尺）
uniform float u_kMin;        // 此層負責的波數範圍
uniform float u_kMax;
uniform float u_alpha;       // 風浪的 JONSWAP 參數
uniform float u_omegaPeak;
uniform float u_windAngle;   // 風浪前進方向在 xz 平面的角度
uniform float u_heightScale; // 只放大或縮小風浪
uniform float u_swellAlpha;  // 湧浪的 JONSWAP 參數（0 代表沒有湧浪）
uniform float u_swellOmegaPeak;
uniform float u_swellAngle;
uniform float u_swellSpread;
uniform float u_swellSpreadNorm;

out vec4 fragColor;

const float PI = 3.14159265358979;
const float G = 9.81;
const float GAMMA = 3.3;
const float SWELL_GAMMA = 7.0;

float jonswap(float omega, float alpha, float omegaPeak, float gamma) {
  float sigma = omega <= omegaPeak ? 0.07 : 0.09;
  float d = omega - omegaPeak;
  float r = exp(-(d * d) / (2.0 * sigma * sigma * omegaPeak * omegaPeak));
  float ratio = omegaPeak / omega;
  return alpha * G * G / pow(omega, 5.0) * exp(-1.25 * ratio * ratio * ratio * ratio) * exp(r * log(gamma));
}

float donelanBanner(float theta, float omega) {
  float ratio = omega / u_omegaPeak;
  float beta;
  if (ratio < 0.95) {
    beta = 2.61 * pow(ratio, 1.3);
  } else if (ratio < 1.6) {
    beta = 2.28 * pow(ratio, -0.65);
  } else {
    beta = pow(10.0, -0.4 + 0.8393 * exp(-0.567 * log(ratio * ratio)));
  }
  beta = max(beta, 1e-3);
  float sech = 1.0 / cosh(beta * theta);
  return beta / (2.0 * tanh(beta * PI)) * sech * sech;
}

// 角度差換算到 [-π, π]
float angleBetween(float a, float b) {
  float d = a - b;
  return atan(sin(d), cos(d));
}

vec2 h0At(ivec2 ij) {
  vec2 n = vec2(ij);
  n -= u_size * step(u_size * 0.5, n);
  if (n.x == -u_size * 0.5 || n.y == -u_size * 0.5) return vec2(0.0);
  float dk = 2.0 * PI / u_length;
  vec2 k = n * dk;
  float kLength = length(k);
  if (kLength < 1e-6 || kLength < u_kMin || kLength >= u_kMax) return vec2(0.0);
  float omega = sqrt(G * kLength);
  float direction = atan(k.y, k.x);

  float wind = jonswap(omega, u_alpha, u_omegaPeak, GAMMA)
    * donelanBanner(angleBetween(direction, u_windAngle), omega) * u_heightScale * u_heightScale;
  float swell = 0.0;
  if (u_swellAlpha > 0.0) {
    float spread = pow(max(abs(cos(0.5 * angleBetween(direction, u_swellAngle))), 1e-6), 2.0 * u_swellSpread);
    swell = jonswap(omega, u_swellAlpha, u_swellOmegaPeak, SWELL_GAMMA) * spread * u_swellSpreadNorm;
  }

  // 由頻率頻譜轉換成波向量頻譜：S(k) = S(ω) D(θ) (dω/dk) / k，再乘上格點面積 Δk²
  float toEnergy = (G / (2.0 * omega)) / kLength * dk * dk / 4.0;
  vec4 noise = texelFetch(u_noise, ij, 0);
  // 風浪：高斯振幅（瑞利分布）；湧浪：固定振幅、隨機相位，兩者的期望能量相同（E|ξ|² = 2）
  vec2 swellPhase = length(noise.zw) > 1e-6 ? normalize(noise.zw) * sqrt(2.0) : vec2(sqrt(2.0), 0.0);
  return noise.xy * sqrt(wind * toEnergy) + swellPhase * sqrt(swell * toEnergy);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int n = int(u_size);
  ivec2 mirrored = ivec2((n - ij.x) % n, (n - ij.y) % n);
  vec2 h = h0At(ij);
  vec2 hMinus = h0At(mirrored);
  fragColor = vec4(h, hMinus.x, -hMinus.y);
}
