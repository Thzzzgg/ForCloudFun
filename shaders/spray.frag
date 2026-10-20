#version 300 es
// 浪花飛沫的形狀：沿飛行方向拉長的柔和水霧，用泡沫紋理打散成一絲一絲的質感（輸出預乘 alpha）
precision highp float;
precision highp sampler2D;

in vec2 v_corner;
in vec3 v_color;
in float v_alpha;
in float v_seed;

uniform sampler2D u_foamDetail;

out vec4 fragColor;

void main() {
  float noise = texture(u_foamDetail, v_corner * vec2(0.08, 0.3) + v_seed * 7.3).g;
  float r2 = dot(v_corner, v_corner);
  float falloff = max(1.0 - r2, 0.0);
  float alpha = falloff * falloff * smoothstep(0.25, 0.8, noise + 0.25 * falloff) * v_alpha * 0.3;
  if (alpha < 0.002) discard;
  fragColor = vec4(v_color * alpha, alpha);
}
