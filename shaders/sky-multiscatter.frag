#version 300 es
// 多重散射查找表（Hillaire 2020）：大氣中某高度、某太陽角度時，從四面八方散射過來又再散射的光
// 只跟大氣有關，載入時算一次；少了它天頂會太暗，日落後的天空也不夠藍
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "atmosphere.glsl"

in vec2 v_uv;

uniform sampler2D u_transmittance;

out vec4 fragColor;

const int DIRECTIONS = 8; // 8 × 8 個均勻分布的方向
const int STEPS = 20;

void main() {
  float muSun = fromTexel(v_uv.x, MULTI_SCATTERING_SIZE) * 2.0 - 1.0;
  float height = fromTexel(v_uv.y, MULTI_SCATTERING_SIZE) * (u_atmosphereRadius - u_earthRadius);
  float r = u_earthRadius + max(height, 0.001);
  vec3 origin = vec3(0.0, r, 0.0);
  vec3 sunDir = vec3(sqrt(max(1.0 - muSun * muSun, 0.0)), muSun, 0.0);

  // 各方向射線上第一次散射（等向相位）的光（secondOrder）與「單位光照下散射回來的比例」（transfer）
  vec3 secondOrder = vec3(0.0);
  vec3 transfer = vec3(0.0);
  for (int i = 0; i < DIRECTIONS; i++) {
    for (int j = 0; j < DIRECTIONS; j++) {
      float theta = 2.0 * PI * (float(i) + 0.5) / float(DIRECTIONS);
      float cosPhi = 1.0 - 2.0 * (float(j) + 0.5) / float(DIRECTIONS);
      float sinPhi = sqrt(1.0 - cosPhi * cosPhi);
      vec3 dir = vec3(cos(theta) * sinPhi, cosPhi, sin(theta) * sinPhi);
      float dist = hitsGround(r, dir.y) ? distanceToGround(r, dir.y) : distanceToTop(r, dir.y);
      float dt = dist / float(STEPS);
      vec3 throughput = vec3(1.0);
      for (int s = 0; s < STEPS; s++) {
        vec3 p = origin + dir * ((float(s) + 0.5) * dt);
        float rp = length(p);
        vec3 density = densities(rp - u_earthRadius);
        vec3 scattering = u_betaRayleigh * density.x + u_betaMie * density.y;
        vec3 extinction = max(extinctionOf(density), vec3(1e-7));
        vec3 stepTransmittance = exp(-extinction * dt);
        vec3 sunTransmittance = transmittanceToTop(u_transmittance, rp, dot(p, sunDir) / rp);
        // 在這一小段內積分（假設係數不變）：∫ e^(-σt) dt = (1 - e^(-σΔt)) / σ
        vec3 segment = throughput * (1.0 - stepTransmittance) / extinction;
        secondOrder += segment * scattering * sunTransmittance / (4.0 * PI);
        transfer += segment * scattering;
        throughput *= stepTransmittance;
      }
    }
  }
  // 對所有方向平均（等於乘上等向相位後對球面積分）；無限多次散射是公比為 transfer 的等比級數
  float count = float(DIRECTIONS * DIRECTIONS);
  secondOrder /= count;
  transfer /= count;
  fragColor = vec4(secondOrder / (1.0 - transfer), 1.0);
}
