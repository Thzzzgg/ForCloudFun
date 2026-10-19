#version 300 es
// Stockham 基數 2 逆向 FFT 的其中一回合（不正規化），同時處理兩張紋理共 4 個複數序列
// 先沿 x 方向做 log2(N) 回合，再沿 y 方向做 log2(N) 回合
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_inputA;
uniform sampler2D u_inputB;
uniform int u_size;         // N
uniform int u_subSize;      // 本回合的子轉換長度：2, 4, ..., N
uniform int u_horizontal;   // 1 = 沿 x 方向，0 = 沿 y 方向

layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

const float PI = 3.14159265358979;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int index = u_horizontal == 1 ? p.x : p.y;
  int halfSub = u_subSize / 2;
  int evenIndex = (index / u_subSize) * halfSub + (index % halfSub);
  int oddIndex = evenIndex + u_size / 2;
  ivec2 evenPos = u_horizontal == 1 ? ivec2(evenIndex, p.y) : ivec2(p.x, evenIndex);
  ivec2 oddPos = u_horizontal == 1 ? ivec2(oddIndex, p.y) : ivec2(p.x, oddIndex);

  float angle = 2.0 * PI * float(index % u_subSize) / float(u_subSize);
  vec2 twiddle = vec2(cos(angle), sin(angle));

  vec4 evenA = texelFetch(u_inputA, evenPos, 0);
  vec4 oddA = texelFetch(u_inputA, oddPos, 0);
  vec4 evenB = texelFetch(u_inputB, evenPos, 0);
  vec4 oddB = texelFetch(u_inputB, oddPos, 0);

  outA = vec4(evenA.xy + cmul(twiddle, oddA.xy), evenA.zw + cmul(twiddle, oddA.zw));
  outB = vec4(evenB.xy + cmul(twiddle, oddB.xy), evenB.zw + cmul(twiddle, oddB.zw));
}
