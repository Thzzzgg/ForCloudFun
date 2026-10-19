#version 300 es
// 預先計算天空：以單次散射的大氣模型（Rayleigh + Mie）沿視線做光線步進
// 結果存成經緯度貼圖，天空背景與海面反射都從這張貼圖取樣
precision highp float;
precision highp sampler2D;

#include "common.glsl"

in vec2 v_uv;

uniform vec3 u_sunDir;
uniform vec3 u_betaRayleigh;     // 單位：1/km
uniform float u_betaMie;
uniform float u_rayleighHeight;  // 單位：km
uniform float u_mieHeight;
uniform float u_mieG;
uniform float u_earthRadius;
uniform float u_atmosphereRadius;
uniform float u_sunIntensity;

out vec4 fragColor;

const int VIEW_STEPS = 32;
const int LIGHT_STEPS = 8;
const float VIEW_EXTINCTION = 0.55;

// 回傳射線與球面交點的距離 (近, 遠)
vec2 raySphere(vec3 origin, vec3 dir, float radius) {
  float b = dot(origin, dir);
  float c = dot(origin, origin) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

void main() {
  vec3 dir = skyUVToDir(v_uv);
  vec3 origin = vec3(0.0, u_earthRadius + 0.02, 0.0);
  float rayLength = raySphere(origin, dir, u_atmosphereRadius).y;

  float mu = dot(dir, u_sunDir);
  float g = u_mieG;
  float phaseRayleigh = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float phaseMie = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu))
    / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  vec3 sumRayleigh = vec3(0.0);
  vec3 sumMie = vec3(0.0);
  float depthRayleigh = 0.0;
  float depthMie = 0.0;

  for (int i = 0; i < VIEW_STEPS; i++) {
    // 取樣點採平方分布，靠近地面（空氣較濃）的地方取樣較密
    float s0 = float(i) / float(VIEW_STEPS);
    float s1 = float(i + 1) / float(VIEW_STEPS);
    float t = 0.5 * (s0 * s0 + s1 * s1) * rayLength;
    float ds = (s1 * s1 - s0 * s0) * rayLength;
    vec3 p = origin + dir * t;
    float height = length(p) - u_earthRadius;
    float densityRayleigh = exp(-height / u_rayleighHeight) * ds;
    float densityMie = exp(-height / u_mieHeight) * ds;
    depthRayleigh += densityRayleigh;
    depthMie += densityMie;

    float lightLength = raySphere(p, u_sunDir, u_atmosphereRadius).y;
    float lightStep = lightLength / float(LIGHT_STEPS);
    float lightRayleigh = 0.0;
    float lightMie = 0.0;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      vec3 q = p + u_sunDir * (float(j) + 0.5) * lightStep;
      float h = length(q) - u_earthRadius;
      lightRayleigh += exp(-h / u_rayleighHeight) * lightStep;
      lightMie += exp(-h / u_mieHeight) * lightStep;
    }

    // 單次散射模型少算了多重散射補回來的光，地平線會偏暗偏橘；
    // 這裡把視線方向的消光打折，近似多重散射的效果
    vec3 opticalDepth = u_betaRayleigh * (depthRayleigh * VIEW_EXTINCTION + lightRayleigh)
      + u_betaMie * 1.1 * (depthMie * VIEW_EXTINCTION + lightMie);
    vec3 attenuation = exp(-opticalDepth);
    sumRayleigh += attenuation * densityRayleigh;
    sumMie += attenuation * densityMie;
  }

  vec3 color = u_sunIntensity * (sumRayleigh * u_betaRayleigh * phaseRayleigh + sumMie * u_betaMie * phaseMie);
  fragColor = vec4(color, 1.0);
}
