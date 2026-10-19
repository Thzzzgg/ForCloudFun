#version 300 es
// 光暈第一步：縮小一半並只保留高亮部分；用 Karis 平均抑制單點過亮造成的閃爍
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_source;
uniform vec2 u_texel;        // 來源貼圖的一個像素大小
uniform float u_threshold;
uniform float u_knee;

out vec4 fragColor;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 a = texture(u_source, v_uv + u_texel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(u_source, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(u_source, v_uv + u_texel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(u_source, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  float wa = 1.0 / (1.0 + luminance(a));
  float wb = 1.0 / (1.0 + luminance(b));
  float wc = 1.0 / (1.0 + luminance(c));
  float wd = 1.0 / (1.0 + luminance(d));
  vec3 color = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);

  // 柔和門檻：超過門檻的亮度才會產生光暈
  float brightness = max(color.r, max(color.g, color.b));
  float soft = clamp(brightness - u_threshold + u_knee, 0.0, 2.0 * u_knee);
  soft = soft * soft / (4.0 * u_knee + 1e-5);
  float contribution = max(soft, brightness - u_threshold) / max(brightness, 1e-5);
  fragColor = vec4(color * contribution, 1.0);
}
