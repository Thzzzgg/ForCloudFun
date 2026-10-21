#version 300 es
// 遠方的船：模型座標（前方 +z、上方 +y、左舷 +x）依船的位置與姿態變換到世界座標
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
layout(location = 3) in vec3 a_backColor;

uniform mat4 u_viewProjection;
uniform mat4 u_model;            // 只有旋轉與平移

out vec3 v_worldPos;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_backColor;

void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  v_normal = mat3(u_model) * a_normal;
  v_color = a_color;
  v_backColor = a_backColor;
  gl_Position = u_viewProjection * world;
}
