#version 300 es
// 依時間演進頻譜，並把 8 個需要的實數場兩兩打包成 4 個複數，一次 IFFT 算出
// A = (Dx + i·h, Dz + i·∂h/∂x)，B = (∂h/∂z + i·∂Dx/∂x, ∂Dz/∂z + i·∂Dx/∂z)
precision highp float;
precision highp sampler2D;

uniform sampler2D u_h0;     // (h0(k), conj(h0(-k)))
uniform float u_time;       // 已對循環週期取餘數的時間
uniform float u_length;
uniform float u_size;
uniform float u_omega0;     // 頻率量化的基頻，讓動畫可以無縫循環

layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

const float PI = 3.14159265358979;
const float G = 9.81;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 mulI(vec2 a) {
  return vec2(-a.y, a.x);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 h0 = texelFetch(u_h0, ij, 0);
  vec2 n = vec2(ij);
  n -= u_size * step(u_size * 0.5, n);
  vec2 k = 2.0 * PI * n / u_length;
  float kLength = length(k);

  // 深水色散關係 ω = √(gk)
  float omega = floor(sqrt(G * kLength) / u_omega0) * u_omega0;
  float phase = omega * u_time;
  vec2 e = vec2(cos(phase), sin(phase));
  // h(k, t) = h0(k)·e^{-iωt} + conj(h0(-k))·e^{iωt}
  vec2 h = cmul(h0.xy, vec2(e.x, -e.y)) + cmul(h0.zw, e);
  vec2 ih = mulI(h);
  float invK = kLength > 1e-6 ? 1.0 / kLength : 0.0;

  vec2 dx = ih * k.x * invK;          // 水平位移 Dx
  vec2 dz = ih * k.y * invK;          // 水平位移 Dz
  vec2 hx = ih * k.x;                 // ∂h/∂x
  vec2 hz = ih * k.y;                 // ∂h/∂z
  vec2 dxx = -h * k.x * k.x * invK;   // ∂Dx/∂x
  vec2 dzz = -h * k.y * k.y * invK;   // ∂Dz/∂z
  vec2 dxz = -h * k.x * k.y * invK;   // ∂Dx/∂z

  outA = vec4(dx + mulI(h), dz + mulI(hx));
  outB = vec4(hz + mulI(dxx), dzz + mulI(dxz));
}
