#version 300 es
// 海面著色：天空與浮標的反射（Fresnel）、太陽與月亮的高光（GGX）、次表面散射、白浪泡沫、雲影與大氣透視
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"
#include "buoy.glsl"

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
uniform vec2 u_windDir;          // 風吹往的方向（xz 平面的單位向量）
uniform float u_foamStreaks;     // 強風時沿風向的泡沫條紋（0 = 沒有）
uniform float u_streakDrift;     // 條紋隨表層海流往下風處漂移的距離（公尺）
uniform sampler2D u_probe;       // 這一幀的海面取樣結果（js/wave-probe.js），其中一欄是浮標的位置與坡度
uniform int u_buoyProbe;         // 浮標在取樣結果中的欄位
uniform vec2 u_buoyAnchor;       // 浮標錨定的海面位置 (x, z)
uniform float u_buoyFoam;        // 吃水線泡沫圈的強度（0～1），浪越大越寬、越密
uniform float u_lampIntensity;   // 浮標燈號在畫面上的亮度
uniform float u_time;

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

  // 浮標的位置與座標系：和浮標本身一樣取自這一幀的海面取樣，倒影與泡沫圈才會跟著浮標走
  vec3 buoyDisplacement = texelFetch(u_probe, ivec2(u_buoyProbe, 0), 0).xyz;
  vec3 buoyCenter = vec3(u_buoyAnchor.x, 0.0, u_buoyAnchor.y) + buoyDisplacement;
  mat3 buoyFrame = buoyBasis(texelFetch(u_probe, ivec2(u_buoyProbe, 1), 0));

  // 浮標的倒影：反射方向若擊中浮標，就以浮標該處的顏色取代天空
  float buoyHeight;
  vec3 buoyNormal;
  if (traceBuoy(v_worldPos, normalize(R), buoyCenter, buoyFrame, buoyHeight, buoyNormal)) {
    vec4 paint = buoyColorAt(buoyHeight);
    vec3 albedo = paint.rgb * mix(0.55, 1.0, smoothstep(0.0, 0.25, buoyHeight)); // 吃水線附近被打濕
    vec3 buoyColor = albedo * skyAmbient(u_sky) * (0.6 + 0.4 * buoyNormal.y);
    for (int i = 0; i < 2; i++) {
      buoyColor += albedo * u_lightColor[i] * max(dot(buoyNormal, u_lightDir[i]), 0.0) / PI;
    }
    buoyColor += paint.w * vec3(1.0, 0.86, 0.55) * u_lampIntensity / autoExposure(u_sky);
    reflection = buoyColor;
  }

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

  // 強風時，碎浪留下的泡沫被風拉成細長的條紋：把泡沫紋理沿風向拉長，再用低頻噪音讓條紋一段一段的；
  // 拉長的紋理在遠處容易產生摩爾紋，所以隨距離淡出
  if (u_foamStreaks > 0.0) {
    vec2 across = vec2(-u_windDir.y, u_windDir.x);
    vec2 streakUV = vec2(dot(v_restXZ, across), dot(v_restXZ, u_windDir) - u_streakDrift) * vec2(0.05, 0.004);
    float lines = texture(u_foamDetail, streakUV).r;
    float patches = texture(u_foamDetail, v_restXZ * 0.004 + 0.31).g;
    // 風越強，條紋越寬、越密
    float streaks = smoothstep(0.66 - 0.12 * u_foamStreaks, 0.82, lines) * smoothstep(0.15, 0.55, patches)
      * smoothstep(0.25, 0.6, detail) * (1.0 - smoothstep(60.0, 250.0, dist)) * u_foamStreaks;
    foamMask = max(foamMask, streaks * 0.75);
  }
  // 吃水線的泡沫圈：浮標隨浪起伏，把周圍的海水攪出一圈不斷翻動的白色泡沫
  float ringDistance = max(length(v_worldPos.xz - buoyCenter.xz) - BUOY_RADIUS, 0.0);
  float ring = (1.0 - smoothstep(0.0, 0.2 + 0.7 * u_buoyFoam, ringDistance)) * u_buoyFoam;
  vec4 bubbleNoise = texture(u_foamDetail, v_restXZ * 0.45 + u_time * vec2(0.011, -0.017));
  float bubbles = 0.6 * bubbleNoise.r + 0.4 * bubbleNoise.g;
  float ringThreshold = 1.0 - 0.75 * ring;
  foamMask = max(foamMask, smoothstep(ringThreshold, ringThreshold + 0.25, bubbles) * smoothstep(0.0, 0.3, ring) * 0.9);

  color = mix(color, vec3(0.75) * foamLight, foamMask);

  color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
  fragColor = vec4(min(color, vec3(5000.0)), 1.0);
}
