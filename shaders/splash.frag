#version 300 es
// 水花的形狀：邊緣柔和的圓點（輸出預乘 alpha）
precision highp float;

in vec2 v_corner;
in vec3 v_color;
in float v_alpha;

out vec4 fragColor;

void main() {
  float r2 = dot(v_corner, v_corner);
  if (r2 >= 1.0) discard;
  float alpha = (1.0 - r2) * v_alpha;
  fragColor = vec4(v_color * alpha, alpha);
}
