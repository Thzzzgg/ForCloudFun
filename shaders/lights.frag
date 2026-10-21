#version 300 es
// 航行燈的光點：中心最亮、往外柔和地暗下來（以相加混合疊上去）
precision highp float;

in vec3 v_color;

out vec4 fragColor;

void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 >= 1.0) discard;
  fragColor = vec4(v_color * (1.0 - r2), 0.0);
}
