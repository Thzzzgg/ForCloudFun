#version 300 es
// 穿透率查找表：大氣中任一高度、往任一方向（地平線以上）穿出大氣層的穿透率，載入時算一次
precision highp float;

#include "common.glsl"
#include "atmosphere.glsl"

in vec2 v_uv;

out vec4 fragColor;

const int STEPS = 40;

void main() {
  // 查找表座標換回 (r, mu)，見 atmosphere.glsl 的 transmittanceUV
  float top = sqrt((u_atmosphereRadius - u_earthRadius) * (u_atmosphereRadius + u_earthRadius));
  float rho = top * fromTexel(v_uv.y, TRANSMITTANCE_SIZE.y);
  float r = sqrt(rho * rho + u_earthRadius * u_earthRadius);
  float dMin = u_atmosphereRadius - r;
  float dMax = rho + top;
  float d = dMin + fromTexel(v_uv.x, TRANSMITTANCE_SIZE.x) * (dMax - dMin);
  float mu = d <= 0.0 ? 1.0 : clamp((top * top - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0);

  float dt = d / float(STEPS);
  vec3 depth = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    float t = (float(i) + 0.5) * dt;
    float h = sqrt(r * r + t * t + 2.0 * r * mu * t) - u_earthRadius;
    depth += densities(h) * dt;
  }
  fragColor = vec4(exp(-extinctionOf(depth)), 1.0);
}
