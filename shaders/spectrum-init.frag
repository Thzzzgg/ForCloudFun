#version 300 es
// 產生初始頻譜 h0(k)：JONSWAP 頻率頻譜 × Donelan-Banner 方向分布 × 固定的高斯亂數
// 輸出 (h0(k), conj(h0(-k)))，只在海況參數改變時執行
precision highp float;
precision highp sampler2D;

uniform sampler2D u_noise;   // 每個頻率格點固定的高斯亂數 (ξr, ξi)
uniform float u_size;        // FFT 尺寸 N
uniform float u_length;      // 此層海面區塊邊長（公尺）
uniform float u_kMin;        // 此層負責的波數範圍
uniform float u_kMax;
uniform float u_alpha;       // JONSWAP 參數
uniform float u_omegaPeak;
uniform float u_windAngle;   // 浪前進方向在 xz 平面的角度
uniform float u_heightScale;

out vec4 fragColor;

const float PI = 3.14159265358979;
const float G = 9.81;
const float GAMMA = 3.3;

float jonswap(float omega) {
  float sigma = omega <= u_omegaPeak ? 0.07 : 0.09;
  float d = omega - u_omegaPeak;
  float r = exp(-(d * d) / (2.0 * sigma * sigma * u_omegaPeak * u_omegaPeak));
  float ratio = u_omegaPeak / omega;
  return u_alpha * G * G / pow(omega, 5.0) * exp(-1.25 * ratio * ratio * ratio * ratio) * exp(r * log(GAMMA));
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

vec2 h0At(ivec2 ij) {
  vec2 n = vec2(ij);
  n -= u_size * step(u_size * 0.5, n);
  if (n.x == -u_size * 0.5 || n.y == -u_size * 0.5) return vec2(0.0);
  float dk = 2.0 * PI / u_length;
  vec2 k = n * dk;
  float kLength = length(k);
  if (kLength < 1e-6 || kLength < u_kMin || kLength >= u_kMax) return vec2(0.0);
  float omega = sqrt(G * kLength);
  float theta = atan(k.y, k.x) - u_windAngle;
  theta = atan(sin(theta), cos(theta));
  // 由頻率頻譜轉換成波向量頻譜：S(k) = S(ω) D(θ) (dω/dk) / k
  float spectrum = jonswap(omega) * donelanBanner(theta, omega) * (G / (2.0 * omega)) / kLength;
  float amplitude = sqrt(spectrum * dk * dk / 4.0) * u_heightScale;
  return texelFetch(u_noise, ij, 0).xy * amplitude;
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int n = int(u_size);
  ivec2 mirrored = ivec2((n - ij.x) % n, (n - ij.y) % n);
  vec2 h = h0At(ij);
  vec2 hMinus = h0At(mirrored);
  fragColor = vec4(h, hMinus.x, -hMinus.y);
}
