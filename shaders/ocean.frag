#version 300 es
// 海面著色：天空反射（Fresnel）、太陽與月亮的高光（GGX）、次表面散射、白浪泡沫、雲影與大氣透視
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

in vec3 v_worldPos;
in vec2 v_restXZ;
in float v_height;

uniform vec3 u_camPos;
uniform vec3 u_lightDir[2];      // 太陽、月亮的方向
uniform vec3 u_lightColor[2];    // 穿過大氣後的光，在地平線下為 0
uniform vec4 u_lengths;          // 四層海面區塊的邊長（公尺）
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;
uniform sampler2D u_derivatives0;
uniform sampler2D u_derivatives1;
uniform sampler2D u_derivatives2;
uniform sampler2D u_derivatives3;
uniform sampler2D u_slopeVariance0;
uniform sampler2D u_slopeVariance1;
uniform sampler2D u_slopeVariance2;
uniform sampler2D u_slopeVariance3;
uniform sampler2D u_sky;         // 含雲的天空
uniform sampler2D u_foamDetail;
uniform vec3 u_scatterColor;     // 海水散射顏色（線性色彩空間）
uniform float u_foamBias;        // 紊流值低於此門檻的地方產生泡沫（由泡沫量與風速決定）
uniform float u_roughness;       // 解析度以下的細微波紋造成的基本粗糙度
uniform float u_fogDensity;

out vec4 fragColor;

// 累加一層的法線資訊、坡度變異數與泡沫
void addCascade(sampler2D displacementTex, sampler2D derivativesTex, sampler2D varianceTex, float patchSize,
                float foamWeight, float foamBias, inout vec4 derivatives, inout float variance, inout float foam) {
  vec2 uv = v_restXZ / patchSize;
  vec4 d = texture(derivativesTex, uv);
  derivatives += d;
  // mipmap 平均後 E[s²] - E[s]² 就是被平均掉的坡度變異，遠處用它加大粗糙度
  variance += max(texture(varianceTex, uv).r - dot(d.xy, d.xy), 0.0);
  float turbulence = texture(displacementTex, uv).a;
  foam += foamWeight * clamp((foamBias - turbulence) * 6.0, 0.0, 1.0);
}

void main() {
  vec4 derivatives = vec4(0.0);
  float variance = 0.0;
  float foam = 0.0;
  // 最大一層只有湧浪與最長的風浪，在深海不會碎浪，所以不產生泡沫
  addCascade(u_displacement0, u_derivatives0, u_slopeVariance0, u_lengths.x, 0.0, u_foamBias, derivatives, variance, foam);
  addCascade(u_displacement1, u_derivatives1, u_slopeVariance1, u_lengths.y, 1.0, u_foamBias, derivatives, variance, foam);
  addCascade(u_displacement2, u_derivatives2, u_slopeVariance2, u_lengths.z, 0.35, u_foamBias, derivatives, variance, foam);
  // 最小一層的波長只有幾十公分，不產生白浪，避免整片海面出現細碎雜點
  addCascade(u_displacement3, u_derivatives3, u_slopeVariance3, u_lengths.w, 0.0, u_foamBias, derivatives, variance, foam);

  vec2 slope = derivatives.xy / max(1.0 + derivatives.zw, vec2(0.25));
  vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

  vec3 toCamera = u_camPos - v_worldPos;
  float dist = length(toCamera);
  vec3 V = toCamera / dist;

  // 遠處掠射角時，部分法線會背對視線，往視線方向修正
  float facing = dot(normal, V);
  if (facing < 0.05) normal = normalize(normal + V * (0.05 - facing));

  float NdotV = clamp(dot(normal, V), 1e-3, 1.0);
  float a2 = clamp(u_roughness * u_roughness + variance, 1e-4, 1.0);
  float alpha = sqrt(a2);

  // 天空反射：越粗糙取越模糊的 mipmap
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
  vec3 R = reflect(-V, normal);
  R.y = abs(R.y);
  vec3 reflection = sampleSky(u_sky, normalize(R), clamp(log2(alpha * 48.0), 0.0, 6.0));

  vec3 ambient = skyAmbient(u_sky);
  float crest = max(v_height, 0.0);
  vec3 foamNormal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), 0.25));
  vec3 specular = vec3(0.0);
  vec3 scatter = 0.35 * u_scatterColor * ambient;
  vec3 foamLight = ambient;
  for (int i = 0; i < 2; i++) {
    if (u_lightColor[i] == vec3(0.0)) continue;
    vec3 L = u_lightDir[i];
    vec3 lightColor = u_lightColor[i] * cloudShadow(v_worldPos, L);
    float NdotL = clamp(dot(normal, L), 0.0, 1.0);

    // 高光：GGX 微表面模型
    vec3 H = normalize(L + V);
    float NdotH = max(dot(normal, H), 0.0);
    float VdotH = max(dot(V, H), 0.0);
    float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * denom * denom);
    float k = alpha * 0.5;
    float visibility = 1.0 / ((NdotL * (1.0 - k) + k) * (NdotV * (1.0 - k) + k));
    float fresnelH = 0.02 + 0.98 * pow(1.0 - VdotH, 5.0);
    specular += lightColor * D * visibility * fresnelH * NdotL * 0.25;

    // 次表面散射：浪峰背光時透出的青綠色，加上正面的散射
    float backLight = pow(max(dot(L, -V), 0.0), 4.0) * pow(0.5 - 0.5 * dot(L, normal), 3.0);
    scatter += (2.5 * crest * backLight + 0.06 * NdotV * NdotV + 0.02 * NdotL) * u_scatterColor * lightColor;
    foamLight += lightColor * max(dot(foamNormal, L), 0.0) / PI;
  }

  vec3 color = (1.0 - fresnel) * scatter + fresnel * reflection + specular;

  // 白浪泡沫：薄的地方只露出網狀細紋，厚的地方才整片泛白，邊緣保持柔和
  float coverage = clamp(foam, 0.0, 1.0);
  vec2 detailUV = v_restXZ * 0.09;
  float detail = texture(u_foamDetail, detailUV).r * 0.65 + texture(u_foamDetail, detailUV * 2.7 + 0.37).g * 0.35;
  float threshold = 1.0 - 0.8 * coverage;
  float foamMask = smoothstep(threshold, threshold + 0.3, detail) * smoothstep(0.0, 0.4, coverage) * 0.88;
  color = mix(color, vec3(0.75) * foamLight, foamMask);

  color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
  fragColor = vec4(min(color, vec3(5000.0)), 1.0);
}
