#version 300 es
// 點擊水面濺起的水花：每個 instance 是一顆水滴（或一團水霧），展開成面向鏡頭的方塊，
// 沿著畫面上的速度方向拉長，像相機拍到的動態模糊；光照在頂點算好，片段著色器只負責形狀
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

layout(location = 0) in vec4 a_position; // (x, y, z, 方塊半徑)
layout(location = 1) in vec4 a_velocity; // (vx, vy, vz, 不透明度)

uniform mat4 u_viewProjection;
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform float u_pixelAngle;      // 一個像素對應的視角（弧度）
uniform vec3 u_lightDir[2];      // 太陽、月亮的方向
uniform vec3 u_lightColor[2];    // 穿過大氣後的光，在地平線下為 0
uniform sampler2D u_sky;
uniform float u_fogDensity;

out vec2 v_corner;               // 方塊內的座標（-1～1）
out vec3 v_color;
out float v_alpha;

const float EXPOSURE_TIME = 0.03; // 動態模糊的曝光時間（秒）

void main() {
  v_corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  vec3 position = a_position.xyz;
  vec3 toCamera = u_camPos - position;
  float dist = length(toCamera);
  vec3 V = toCamera / max(dist, 1e-3);

  // 太小的水滴至少畫成一個像素大，透明度依面積降低，遠處才不會閃爍
  float radius = max(a_position.w, dist * u_pixelAngle);
  float coverage = a_position.w / radius;
  vec3 velocity = a_velocity.xyz;
  vec3 along = velocity - dot(velocity, V) * V; // 速度投影到畫面上的方向
  float speed = length(along);
  along = speed > 1e-3 ? along / speed : u_camRight;
  vec3 across = normalize(cross(V, along));
  vec3 world = position + along * (v_corner.x * (radius + speed * EXPOSURE_TIME)) + across * (v_corner.y * radius);
  gl_Position = u_viewProjection * vec4(world, 1.0);

  // 水滴把天空與陽光往四面八方散射，前向散射最強（Henyey-Greenstein, g = 0.6）：逆光時特別亮
  vec3 color = skyAmbient(u_sky) * 1.1;
  for (int i = 0; i < 2; i++) {
    if (u_lightColor[i] == vec3(0.0)) continue;
    vec3 L = u_lightDir[i];
    float g = 0.6;
    float mu = -dot(L, V);
    float phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    color += u_lightColor[i] * cloudShadow(position, L) * (0.12 + 2.0 * phase);
  }
  v_color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
  // 貼近鏡頭時淡出，免得一大片白擋住畫面
  v_alpha = a_velocity.w * coverage * coverage * smoothstep(0.8, 2.5, dist);
}
