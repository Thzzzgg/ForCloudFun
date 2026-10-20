#version 300 es
// 浮標：在 GPU 上取樣浮標位置的海面位移與坡度，讓浮標隨浪起伏與傾斜
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
layout(location = 3) in float a_emissive;

uniform mat4 u_viewProjection;
uniform vec2 u_anchor;        // 浮標錨定的海面位置 (x, z)
uniform float u_footprint;    // 浮標底面大小：取樣這個範圍的平均，過濾掉小波紋
uniform float u_time;
uniform vec4 u_lengths;       // 四層海面區塊的邊長（公尺）
uniform float u_texSize;
uniform float u_maxLod;
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;
uniform sampler2D u_derivatives0;
uniform sampler2D u_derivatives1;
uniform sampler2D u_derivatives2;
uniform sampler2D u_derivatives3;

out vec3 v_worldPos;
out vec3 v_normal;
out vec3 v_color;
out float v_emissive;
out float v_localY;

float lodFor(float patchSize) {
  return clamp(log2(max(u_footprint * u_texSize / patchSize, 1.0)), 0.0, u_maxLod);
}

vec3 rotateY(vec3 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
  vec2 uv0 = u_anchor / u_lengths.x;
  vec2 uv1 = u_anchor / u_lengths.y;
  vec2 uv2 = u_anchor / u_lengths.z;
  vec2 uv3 = u_anchor / u_lengths.w;
  float lod0 = lodFor(u_lengths.x);
  float lod1 = lodFor(u_lengths.y);
  float lod2 = lodFor(u_lengths.z);
  float lod3 = lodFor(u_lengths.w);

  vec3 displacement = textureLod(u_displacement0, uv0, lod0).xyz
    + textureLod(u_displacement1, uv1, lod1).xyz
    + textureLod(u_displacement2, uv2, lod2).xyz
    + textureLod(u_displacement3, uv3, lod3).xyz;
  vec4 derivatives = textureLod(u_derivatives0, uv0, lod0)
    + textureLod(u_derivatives1, uv1, lod1)
    + textureLod(u_derivatives2, uv2, lod2)
    + textureLod(u_derivatives3, uv3, lod3);
  vec2 slope = derivatives.xy / max(1.0 + derivatives.zw, vec2(0.25));
  vec3 up = normalize(vec3(-slope.x, 1.0, -slope.y));
  up = normalize(mix(vec3(0.0, 1.0, 0.0), up, 0.85));

  // 依海面法線建立浮標的座標系，再加上緩慢的左右擺動
  vec3 forward = normalize(cross(vec3(1.0, 0.0, 0.0), up));
  vec3 right = cross(up, forward);
  mat3 basis = mat3(right, up, forward);
  float yaw = sin(u_time * 0.21) * 0.35 + sin(u_time * 0.13 + 1.7) * 0.2;

  vec3 center = vec3(u_anchor.x + displacement.x, displacement.y, u_anchor.y + displacement.z);
  vec3 world = center + basis * rotateY(a_position, yaw);

  v_worldPos = world;
  v_normal = basis * rotateY(a_normal, yaw);
  v_color = a_color;
  v_emissive = a_emissive;
  v_localY = a_position.y;
  gl_Position = u_viewProjection * vec4(world, 1.0);
}
