#version 300 es
// 最終合成：HDR 畫面 × 自動曝光 + 光暈（已曝光）→ ACES 色調映射 → sRGB，再加上輕微暗角與抖色避免色帶
precision highp float;
precision highp sampler2D;

#include "common.glsl"

in vec2 v_uv;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_sky;     // 用來計算自動曝光
uniform float u_bloomStrength;
uniform float u_time;

out vec4 fragColor;

// Stephen Hill 的 ACES 擬合（RRT + ODT）
const mat3 ACES_INPUT = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);
const mat3 ACES_OUTPUT = mat3(
  1.60475, -0.10208, -0.00327,
  -0.53108, 1.10813, -0.07276,
  -0.07367, -0.00605, 1.07602
);

vec3 acesFitted(vec3 color) {
  color = ACES_INPUT * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  return clamp(ACES_OUTPUT * (a / b), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 exposed = texture(u_scene, v_uv).rgb * autoExposure(u_sky) + texture(u_bloom, v_uv).rgb * u_bloomStrength;
  vec3 color = linearToSrgb(acesFitted(exposed));
  vec2 q = v_uv - 0.5;
  color *= 1.0 - dot(q, q) * 0.3;
  color += (hash(gl_FragCoord.xy + fract(u_time) * 61.0) - 0.5) / 255.0;
  fragColor = vec4(color, 1.0);
}
