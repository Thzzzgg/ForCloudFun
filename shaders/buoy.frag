#version 300 es
// 浮標著色：太陽與月亮的漫射與高光 + 天空環境光，吃水線有浪打上來的泡沫，頂端燈號會閃爍
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

in vec3 v_worldPos;
in vec3 v_normal;
in vec3 v_color;
in float v_emissive;
in float v_localY;
in vec3 v_local;
in vec2 v_restXZ;

uniform vec3 u_camPos;
uniform vec3 u_lightDir[2];      // 太陽、月亮的方向
uniform vec3 u_lightColor[2];    // 穿過大氣後的光，在地平線下為 0
uniform sampler2D u_sky;
uniform float u_lampIntensity;   // 燈號在畫面上的亮度（曝光後），不論白天夜晚都一樣
uniform float u_fogDensity;
uniform vec4 u_lengths;          // 四層海面區塊的邊長（公尺），與頂點著色器共用
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;
uniform sampler2D u_foamDetail;
uniform float u_contactFoam;     // 吃水線泡沫的強度（0～1），浪越大越多
uniform float u_time;

out vec4 fragColor;

// 這一點的水位（四層疊加的海面高度）
float waterHeight(vec2 xz) {
  return textureLod(u_displacement0, xz / u_lengths.x, 0.0).y
    + textureLod(u_displacement1, xz / u_lengths.y, 0.0).y
    + textureLod(u_displacement2, xz / u_lengths.z, 0.0).y
    + textureLod(u_displacement3, xz / u_lengths.w, 0.0).y;
}

void main() {
  vec3 N = normalize(v_normal);
  vec3 toCamera = u_camPos - v_worldPos;
  float dist = length(toCamera);
  vec3 V = toCamera / dist;
  if (dot(N, V) < 0.0) N = -N;

  // 吃水線附近被海水打濕，顏色較深
  vec3 albedo = v_color * mix(0.55, 1.0, smoothstep(0.0, 0.25, v_localY));
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 irradiance = skyAmbient(u_sky) * (0.6 + 0.4 * N.y);
  vec3 specular = sampleSky(u_sky, reflect(-V, N), 4.0) * fresnel * 0.5;
  for (int i = 0; i < 2; i++) {
    if (u_lightColor[i] == vec3(0.0)) continue;
    vec3 L = u_lightDir[i];
    vec3 lightColor = u_lightColor[i] * cloudShadow(v_worldPos, L);
    float NdotL = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    irradiance += lightColor * NdotL / PI;
    specular += lightColor * pow(max(dot(N, H), 0.0), 60.0) * fresnel * NdotL * 2.0;
  }
  vec3 color = albedo * irradiance + specular;

  // 浪打在浮體上的泡沫：在這一點的水位附近、浮體表面畫一圈白色泡沫，跟著浪上下移動並不斷翻動
  // （紋理座標繞浮標一圈剛好重複 3 次，接縫處才連續）
  float above = v_worldPos.y - waterHeight(v_restXZ);
  float band = smoothstep(-0.05, 0.0, above) * (1.0 - smoothstep(0.04, 0.2 + 0.15 * u_contactFoam, above));
  vec2 foamUV = vec2(atan(v_local.z, v_local.x) * (3.0 / (2.0 * PI)), v_local.y * 0.7 - u_time * 0.08);
  vec4 bubbleNoise = textureLod(u_foamDetail, foamUV, 1.0);
  float bubbles = 0.5 * bubbleNoise.r + 0.5 * bubbleNoise.g;
  float contact = smoothstep(0.35, 0.6, bubbles + 0.4 * band - 0.2) * band * u_contactFoam;
  color = mix(color, vec3(0.8) * irradiance, contact);

  color += v_emissive * vec3(1.0, 0.86, 0.55) * u_lampIntensity / autoExposure(u_sky);
  color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
  fragColor = vec4(color, 1.0);
}
