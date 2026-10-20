#version 300 es
// 海面取樣：在指定位置讀出四層疊加後的位移與導數，供 CPU 非同步讀回（船上視角、避免鏡頭沒入水中）
// 輸出貼圖的寬度 = 取樣點數；第 0 列為位移 (Dx, h, Dz)，第 1 列為導數 (∂h/∂x, ∂h/∂z, λ∂Dx/∂x, λ∂Dz/∂z)
precision highp float;
precision highp int;
precision highp sampler2D;

const int MAX_POINTS = 4; // 需與 js/wave-probe.js 一致

uniform vec3 u_points[MAX_POINTS]; // (x, z, 取樣範圍)：範圍越大，平均掉越多小波紋
uniform vec4 u_lengths;
uniform float u_texSize;
uniform float u_maxLod;
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;
uniform sampler2D u_derivatives0;
uniform sampler2D u_derivatives1;
uniform sampler2D u_derivatives2;
uniform sampler2D u_derivatives3;

out vec4 fragColor;

float lodFor(float patchSize, float footprint) {
  return clamp(log2(max(footprint * u_texSize / patchSize, 1.0)), 0.0, u_maxLod);
}

void main() {
  vec3 point = u_points[min(int(gl_FragCoord.x), MAX_POINTS - 1)];
  vec2 xz = point.xy;
  float footprint = point.z;
  vec4 lod = vec4(
    lodFor(u_lengths.x, footprint), lodFor(u_lengths.y, footprint),
    lodFor(u_lengths.z, footprint), lodFor(u_lengths.w, footprint));

  if (gl_FragCoord.y < 1.0) {
    vec3 displacement = textureLod(u_displacement0, xz / u_lengths.x, lod.x).xyz
      + textureLod(u_displacement1, xz / u_lengths.y, lod.y).xyz
      + textureLod(u_displacement2, xz / u_lengths.z, lod.z).xyz
      + textureLod(u_displacement3, xz / u_lengths.w, lod.w).xyz;
    fragColor = vec4(displacement, 1.0);
  } else {
    fragColor = textureLod(u_derivatives0, xz / u_lengths.x, lod.x)
      + textureLod(u_derivatives1, xz / u_lengths.y, lod.y)
      + textureLod(u_derivatives2, xz / u_lengths.z, lod.z)
      + textureLod(u_derivatives3, xz / u_lengths.w, lod.w);
  }
}
