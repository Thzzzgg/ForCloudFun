#version 300 es
// 光暈縮小取樣（Dual Kawase 濾波）
precision highp float;
precision highp sampler2D;

in vec2 v_uv;

uniform sampler2D u_source;
uniform vec2 u_texel;

out vec4 fragColor;

void main() {
  vec3 sum = texture(u_source, v_uv).rgb * 4.0;
  sum += texture(u_source, v_uv - u_texel).rgb;
  sum += texture(u_source, v_uv + u_texel).rgb;
  sum += texture(u_source, v_uv + vec2(u_texel.x, -u_texel.y)).rgb;
  sum += texture(u_source, v_uv - vec2(u_texel.x, -u_texel.y)).rgb;
  fragColor = vec4(sum / 8.0, 1.0);
}
