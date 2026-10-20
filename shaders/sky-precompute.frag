#version 300 es
// 預先計算天空：沿視線做光線步進，累加太陽與月光的單次散射（Rayleigh + Mie）與多重散射
// 穿透率與多重散射查表取得（見 atmosphere.glsl）；在地球陰影裡的空氣只剩多重散射，
// 日落後高空仍被照亮，形成暮光。結果存成經緯度貼圖，只在時間改變時重算
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "atmosphere.glsl"

in vec2 v_uv;

uniform sampler2D u_transmittance;
uniform sampler2D u_multiScattering;
uniform vec3 u_sunDir;
uniform vec3 u_moonDir;
uniform float u_sunIntensity;    // 0 表示在地平線下很深，整個大氣都在地球陰影裡（由 js/sky.js 判斷）
uniform float u_moonIntensity;
uniform vec3 u_nightGlow;        // 星光與大氣輝光造成的夜空底光（天頂的亮度）

out vec4 fragColor;

const int VIEW_STEPS = 32;

// 一個光源在 p 點散射進視線的光（每單位長度、光源強度為 1）
vec3 inScattering(vec3 p, float r, vec3 dir, vec3 lightDir, vec3 rayleigh, float mie) {
  float muLight = dot(p, lightDir) / r;
  float nu = dot(dir, lightDir);
  vec3 single = (rayleigh * rayleighPhase(nu) + mie * miePhase(nu)) * transmittanceToTop(u_transmittance, r, muLight);
  vec3 multiple = textureLod(u_multiScattering, multiScatteringUV(r, muLight), 0.0).rgb * (rayleigh + mie);
  return single + multiple;
}

void main() {
  vec3 dir = skyUVToDir(v_uv);
  float r0 = u_earthRadius + 0.02;
  vec3 origin = vec3(0.0, r0, 0.0);
  float rayLength = distanceToTop(r0, dir.y);

  vec3 color = vec3(0.0);
  vec3 throughput = vec3(1.0);
  for (int i = 0; i < VIEW_STEPS; i++) {
    // 取樣點採平方分布，靠近地面（空氣較濃）的地方取樣較密
    float s0 = float(i) / float(VIEW_STEPS);
    float s1 = float(i + 1) / float(VIEW_STEPS);
    float t = 0.5 * (s0 * s0 + s1 * s1) * rayLength;
    float dt = (s1 * s1 - s0 * s0) * rayLength;
    vec3 p = origin + dir * t;
    float r = length(p);
    vec3 density = densities(r - u_earthRadius);
    vec3 rayleigh = u_betaRayleigh * density.x;
    float mie = u_betaMie * density.y;
    vec3 extinction = max(extinctionOf(density), vec3(1e-7));
    vec3 stepTransmittance = exp(-extinction * dt);

    vec3 scattering = vec3(0.0);
    if (u_sunIntensity > 0.0) scattering += u_sunIntensity * inScattering(p, r, dir, u_sunDir, rayleigh, mie);
    if (u_moonIntensity > 0.0) scattering += u_moonIntensity * inScattering(p, r, dir, u_moonDir, rayleigh, mie);
    // 在這一小段內積分（假設係數不變）：∫ e^(-σt) dt = (1 - e^(-σΔt)) / σ
    color += throughput * scattering * (1.0 - stepTransmittance) / extinction;
    throughput *= stepTransmittance;
  }

  // 夜空底光：大氣輝光越接近地平線越亮（視線穿過的發光層越厚）
  color += u_nightGlow * (1.0 + 2.0 * pow(1.0 - dir.y, 6.0));
  fragColor = vec4(color, 1.0);
}
