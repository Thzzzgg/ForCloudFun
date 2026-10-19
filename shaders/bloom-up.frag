#version 300 es
// 光暈放大取樣（Dual Kawase 濾波），以加法混合疊回上一層
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_source;
uniform vec2 u_texel;       // 來源（較小那層）貼圖的一個像素大小

out vec4 fragColor;

void main() {
  vec2 o = u_texel * 0.5;
  vec3 sum = texture(u_source, v_uv + vec2(-2.0 * o.x, 0.0)).rgb;
  sum += texture(u_source, v_uv + vec2(-o.x, o.y)).rgb * 2.0;
  sum += texture(u_source, v_uv + vec2(0.0, 2.0 * o.y)).rgb;
  sum += texture(u_source, v_uv + vec2(o.x, o.y)).rgb * 2.0;
  sum += texture(u_source, v_uv + vec2(2.0 * o.x, 0.0)).rgb;
  sum += texture(u_source, v_uv + vec2(o.x, -o.y)).rgb * 2.0;
  sum += texture(u_source, v_uv + vec2(0.0, -2.0 * o.y)).rgb;
  sum += texture(u_source, v_uv + vec2(-o.x, -o.y)).rgb * 2.0;
  fragColor = vec4(sum / 12.0, 1.0);
}
