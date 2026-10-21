#version 300 es
// 一般物體的著色（海鷗、遠方的船）：太陽與月亮的漫射與高光 + 天空環境光，雲影與大氣透視
// 薄片（翅膀、船帆）兩面都看得到，從背面看時用背面的顏色
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

in vec3 v_worldPos;
in vec3 v_normal;
in vec3 v_color;
in vec3 v_backColor;

uniform vec3 u_camPos;
uniform vec3 u_lightDir[2];      // 太陽、月亮的方向
uniform vec3 u_lightColor[2];    // 穿過大氣後的光，在地平線下為 0
uniform sampler2D u_sky;
uniform float u_fogDensity;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 toCamera = u_camPos - v_worldPos;
  float dist = length(toCamera);
  vec3 V = toCamera / dist;
  vec3 albedo = v_color;
  if (dot(N, V) < 0.0) {
    N = -N;
    albedo = v_backColor;
  }

  vec3 irradiance = skyAmbient(u_sky) * (0.6 + 0.4 * N.y);
  vec3 specular = vec3(0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  for (int i = 0; i < 2; i++) {
    if (u_lightColor[i] == vec3(0.0)) continue;
    vec3 L = u_lightDir[i];
    vec3 lightColor = u_lightColor[i] * cloudShadow(v_worldPos, L);
    float NdotL = max(dot(N, L), 0.0);
    irradiance += lightColor * NdotL / PI;
    specular += lightColor * pow(max(dot(N, normalize(L + V)), 0.0), 40.0) * fresnel * NdotL;
  }
  vec3 color = albedo * irradiance + specular;
  color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
  fragColor = vec4(color, 1.0);
}
