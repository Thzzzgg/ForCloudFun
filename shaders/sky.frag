#version 300 es
// 天空背景：取樣預先計算的天空貼圖，再疊上太陽圓盤
precision highp float;
precision highp sampler2D;

#include "common.glsl"

in vec2 v_uv;

uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec2 u_tanHalfFov;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform sampler2D u_sky;

out vec4 fragColor;

const float SUN_RADIUS = 0.0065;      // 太陽圓盤的角半徑（弧度，略大於實際值）
const float SUN_DISC_RADIANCE = 1500.0;

void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 dir = normalize(u_camForward + ndc.x * u_tanHalfFov.x * u_camRight + ndc.y * u_tanHalfFov.y * u_camUp);
  vec3 color = sampleSky(u_sky, normalize(vec3(dir.x, max(dir.y, 0.0), dir.z)), 0.0);

  float sunAngle = acos(clamp(dot(dir, u_sunDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(SUN_RADIUS * 0.85, SUN_RADIUS * 1.15, sunAngle);
  color += u_sunColor * disc * SUN_DISC_RADIANCE;

  fragColor = vec4(color, 1.0);
}
