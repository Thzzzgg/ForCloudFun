#version 300 es
// 浪花飛沫：每個 instance 是一顆粒子，從狀態貼圖讀出位置，展開成面向鏡頭的方塊
// 一團水霧的光照幾乎一致，所以光照、雲影與大氣透視都在頂點算好，片段著色器只負責形狀
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

uniform sampler2D u_position;    // (x, y, z, 年齡)
uniform sampler2D u_velocity;    // (vx, vy, vz, 壽命)
uniform mat4 u_viewProjection;
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_lightDir[2];      // 太陽、月亮的方向
uniform vec3 u_lightColor[2];    // 穿過大氣後的光，在地平線下為 0
uniform sampler2D u_sky;
uniform float u_fogDensity;
uniform float u_amount;          // 飛沫量 0～1

out vec2 v_corner;               // 方塊內的座標（-1～1），x 沿著飛行方向
out vec3 v_color;
out float v_alpha;
out float v_seed;

void main() {
  int side = textureSize(u_position, 0).x;
  ivec2 texel = ivec2(gl_InstanceID % side, gl_InstanceID / side);
  vec4 position = texelFetch(u_position, texel, 0);
  float life = texelFetch(u_velocity, texel, 0).w;
  v_corner = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  v_seed = fract(float(gl_InstanceID) * 0.618034);
  if (position.w >= life) {
    // 死掉的粒子放到畫面外，整個方塊會被裁掉
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_color = vec3(0.0);
    v_alpha = 0.0;
    return;
  }

  // 剛噴出時是一小團，之後散開變大、變淡；沿著飛行方向拉長，看起來像被風扯開的水霧
  float t = position.w / life;
  float size = mix(0.2, 1.1, sqrt(t)) * (0.7 + 0.6 * v_seed);
  // 只用水平速度決定拉長的方向：朝鏡頭吹來的水霧不會被拉成像雨絲一樣的直線
  vec4 state = texelFetch(u_velocity, texel, 0);
  vec3 velocity = vec3(state.x, 0.0, state.z);
  vec3 view = normalize(position.xyz - u_camPos);
  vec3 along = velocity - dot(velocity, view) * view; // 水平速度投影到畫面上的方向
  float speed = length(along);
  along = speed > 0.5 ? along / speed : u_camRight;
  vec3 across = normalize(cross(view, along));
  float stretch = size + speed * 0.08;
  vec3 worldPos = position.xyz + along * (v_corner.x * stretch) + across * (v_corner.y * size * 0.6);
  gl_Position = u_viewProjection * vec4(worldPos, 1.0);
  vec3 toCamera = u_camPos - position.xyz;
  float dist = length(toCamera);
  vec3 V = toCamera / max(dist, 1e-3);
  // 太靠近鏡頭的會擋住畫面、太遠的只剩一點白點，兩端都淡出
  v_alpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.4, 1.0, t)) * u_amount
    * smoothstep(10.0, 25.0, dist) * (1.0 - smoothstep(70.0, 140.0, dist));
  vec3 color = skyAmbient(u_sky) * 0.9;
  for (int i = 0; i < 2; i++) {
    if (u_lightColor[i] == vec3(0.0)) continue;
    vec3 L = u_lightDir[i];
    // 水滴的前向散射很強（Henyey-Greenstein, g = 0.7）：逆光看時水霧特別亮
    float g = 0.7;
    float mu = -dot(L, V);
    float phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    color += u_lightColor[i] * cloudShadow(position.xyz, L) * (0.06 + 2.5 * phase);
  }
  v_color = applyAerialPerspective(color, -V, dist, u_sky, u_fogDensity);
}
