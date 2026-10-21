#version 300 es
// 船的航行燈：每盞燈畫成一個點，在畫面上的亮度固定（和浮標燈號一樣除以自動曝光），霧中隨距離減弱
precision highp float;
precision highp sampler2D;

#include "common.glsl"

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec4 a_color;    // (r, g, b, 亮度)

uniform mat4 u_viewProjection;
uniform vec3 u_camPos;
uniform float u_pointSize;               // 點的大小（像素）
uniform float u_fogDensity;
uniform sampler2D u_sky;

out vec3 v_color;

void main() {
  // 往鏡頭方向挪一點點：遠處的深度解析度只有幾公尺，燈才不會被它所在的船身擋住
  vec3 position = mix(a_position, u_camPos, 0.01);
  gl_Position = u_viewProjection * vec4(position, 1.0);
  gl_PointSize = u_pointSize;
  float dist = distance(a_position, u_camPos);
  v_color = a_color.rgb * a_color.a * exp(-dist * u_fogDensity) / autoExposure(u_sky);
}
