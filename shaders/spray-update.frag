#version 300 es
// 浪花飛沫的粒子更新：每個像素是一顆粒子，(位置, 年齡) 與 (速度, 壽命) 存在兩張浮點貼圖
// 活著的粒子被風往下風處吹、受重力落下，落回海面或壽命到了就死掉；
// 死掉的粒子在鏡頭前方隨機挑幾個點，遇到正在碎浪的浪峰就從那裡噴出
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D u_position;    // (x, y, z, 年齡)
uniform sampler2D u_velocity;    // (vx, vy, vz, 壽命)
uniform vec4 u_lengths;          // 四層海面區塊的邊長（公尺）
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;
uniform sampler2D u_derivatives0;
uniform sampler2D u_derivatives1;
uniform sampler2D u_derivatives2;
uniform sampler2D u_derivatives3;
uniform float u_deltaTime;
uniform float u_seed;            // 每幀不同的亂數種子
uniform vec2 u_wind;             // 風速向量 (x, z)，m/s
uniform float u_amount;          // 飛沫量 0～1，0 時不再產生新的粒子
uniform vec3 u_camPos;
uniform vec2 u_camForward;       // 鏡頭的水平前方（xz 單位向量）
uniform float u_spawnAngle;      // 產生範圍的半角（弧度）
uniform vec2 u_spawnRange;       // 產生範圍的最近與最遠距離（公尺）

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outVelocity;

const float BREAKING_JACOBIAN = 0.66; // 疊加後的 Jacobian 低於此值的浪頭才噴出飛沫（實測約 2% 的海面）
const float GRAVITY = 5.0;            // 細小水滴的有效重力（亂流讓它們落得比較慢）
const float DRAG = 1.2;               // 水滴速度趨近風速的快慢（1/秒）
const int MAX_TRIES = 4;

uint hashUint(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

float random(inout uint state) {
  state = hashUint(state);
  return float(state >> 8) * (1.0 / 16777216.0);
}

// 靜止位置 xz 的海面位移（四層疊加）
vec3 displacementAt(vec2 xz) {
  return textureLod(u_displacement0, xz / u_lengths.x, 0.0).xyz
    + textureLod(u_displacement1, xz / u_lengths.y, 0.0).xyz
    + textureLod(u_displacement2, xz / u_lengths.z, 0.0).xyz
    + textureLod(u_displacement3, xz / u_lengths.w, 0.0).xyz;
}

// 四層疊加的水平壓縮（Jacobian，略去交叉項）：越小代表浪頭擠得越尖、越可能碎浪
float jacobianAt(vec2 xz) {
  vec2 d = textureLod(u_derivatives0, xz / u_lengths.x, 0.0).zw
    + textureLod(u_derivatives1, xz / u_lengths.y, 0.0).zw
    + textureLod(u_derivatives2, xz / u_lengths.z, 0.0).zw
    + textureLod(u_derivatives3, xz / u_lengths.w, 0.0).zw;
  return (1.0 + d.x) * (1.0 + d.y);
}

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 position = texelFetch(u_position, texel, 0);
  vec4 velocity = texelFetch(u_velocity, texel, 0);
  float dt = u_deltaTime;
  vec3 wind = vec3(u_wind.x, 0.0, u_wind.y);

  if (position.w < velocity.w) {
    velocity.xyz += ((wind - velocity.xyz) * DRAG - vec3(0.0, GRAVITY, 0.0)) * dt;
    position.xyz += velocity.xyz * dt;
    position.w += dt;
    if (position.y < displacementAt(position.xz).y - 0.3) position.w = velocity.w; // 落回海面
  } else if (u_amount > 0.0) {
    // 每幀試的次數依幀時間調整，產生的速度才不會隨幀率改變
    uint state = hashUint(uint(texel.x) + hashUint(uint(texel.y) + hashUint(uint(u_seed))));
    int tries = int(clamp(dt * 120.0, 1.0, float(MAX_TRIES)));
    for (int i = 0; i < MAX_TRIES; i++) {
      if (i >= tries) break;
      // 距離取對數均勻分布：近處的粒子比較多（遠處的飛沫本來就看不太到）
      float angle = (random(state) * 2.0 - 1.0) * u_spawnAngle;
      float dist = u_spawnRange.x * pow(u_spawnRange.y / u_spawnRange.x, random(state));
      float c = cos(angle);
      float s = sin(angle);
      vec2 direction = vec2(c * u_camForward.x - s * u_camForward.y, s * u_camForward.x + c * u_camForward.y);
      vec2 xz = u_camPos.xz + direction * dist;
      float breaking = clamp((BREAKING_JACOBIAN - jacobianAt(xz)) * 10.0, 0.0, 1.0);
      if (random(state) < breaking * u_amount) {
        vec3 crest = displacementAt(xz);
        position = vec4(xz.x + crest.x, crest.y + 0.2, xz.y + crest.z, 0.0);
        vec2 spread = vec2(random(state), random(state)) * 2.0 - 1.0;
        velocity.xyz = wind * (0.2 + 0.3 * random(state)) + vec3(spread.x, 1.0 + 2.5 * random(state), spread.y);
        velocity.w = 1.2 + 1.6 * random(state); // 壽命 1.2～2.8 秒（js/spray.js 的 MAX_LIFE 要比它長）
        break;
      }
    }
  }
  outPosition = position;
  outVelocity = velocity;
}
