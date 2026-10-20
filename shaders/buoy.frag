#version 300 es
// 浮標著色：太陽與月亮的漫射與高光 + 天空環境光，頂端燈號會閃爍
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

in vec3 v_worldPos;
in vec3 v_normal;
in vec3 v_color;
in float v_emissive;
in float v_localY;

uniform vec3 u_camPos;
uniform vec3 u_lightDir[2];      // 太陽、月亮的方向
uniform vec3 u_lightColor[2];    // 穿過大氣後的光，在地平線下為 0
uniform sampler2D u_sky;
uniform float u_lampIntensity;   // 燈號在畫面上的亮度（曝光後），不論白天夜晚都一樣
uniform float u_fogDensity;

out vec4 fragColor;

void main() {
  vec3 N = normalize(v_normal);
  vec3 toCamera = u_camPos - v_worldPos;
  float dist = length(toCamera);
  vec3 V = toCamera / dist;
  if (dot(N, V) < 0.0) N = -N;

  // 吃水線附近被海水打濕，顏色較深
  vec3 albedo = v_color * mix(0.55, 1.0, smoothstep(0.0, 0.25, v_localY));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 color = albedo * skyAmbient(u_sky) * (0.6 + 0.4 * N.y);
  for (int i = 0; i < 2; i++) {
    if (u_lightColor[i] == vec3(0.0)) continue;
    vec3 L = u_lightDir[i];
    vec3 lightColor = u_lightColor[i] * cloudShadow(v_worldPos, L);
    float NdotL = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    color += albedo * lightColor * NdotL / PI;
    color += lightColor * pow(max(dot(N, H), 0.0), 60.0) * fresnel * NdotL * 2.0;
  }
  color += sampleSky(u_sky, reflect(-V, N), 4.0) * fresnel * 0.5;

  color += v_emissive * vec3(1.0, 0.86, 0.55) * u_lampIntensity / autoExposure(u_sky);
  color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
  fragColor = vec4(color, 1.0);
}
