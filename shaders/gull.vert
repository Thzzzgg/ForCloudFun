#version 300 es
// 海鷗：每隻是一個 instance；翅膀以肩膀與腕部為軸上下拍動，再依姿態（側傾、俯仰、航向）放到世界座標
precision highp float;

layout(location = 0) in vec3 a_position;   // 模型座標：前方 +z、上方 +y、左翼在 +x
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
layout(location = 3) in vec3 a_backColor;
layout(location = 4) in float a_part;      // 0 身體，1 內側翅膀，2 外側翅膀
layout(location = 5) in vec4 a_placement;  // (x, y, z, 航向)
layout(location = 6) in vec4 a_attitude;   // (俯仰, 側傾, 拍翅相位, 拍翅幅度 0～1)

uniform mat4 u_viewProjection;

out vec3 v_worldPos;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_backColor;

const float SHOULDER = 0.04; // 翅膀根部與腕部離身體中線的距離（公尺），需與 js/gulls.js 一致
const float WRIST = 0.3;
const float WING_Y = 0.01;

vec2 rotate(vec2 v, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

void main() {
  vec3 p = a_position;
  vec3 n = a_normal;
  if (a_part > 0.5) {
    // 滑翔時翅膀微微上揚、腕部往下折；拍翅時整片上下擺動，外側翅膀稍微落後並在上揚時收起
    float side = sign(p.x);
    float phase = a_attitude.z;
    float flap = a_attitude.w;
    float inner = 0.1 + flap * 0.6 * sin(phase);
    float outer = -0.22 - flap * 0.3 * (0.5 + 0.5 * sin(phase + 0.6));
    if (a_part > 1.5) {
      vec2 wrist = vec2(WRIST * side, WING_Y);
      p.xy = wrist + rotate(p.xy - wrist, outer * side);
      n.xy = rotate(n.xy, outer * side);
    }
    vec2 shoulder = vec2(SHOULDER * side, WING_Y);
    p.xy = shoulder + rotate(p.xy - shoulder, inner * side);
    n.xy = rotate(n.xy, inner * side);
  }
  // 每隻的大小略有不同
  float size = 0.9 + 0.2 * fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
  p *= size;

  // 姿態：先繞前後軸側傾，再繞左右軸俯仰，最後轉到航向
  float pitch = a_attitude.x;
  float roll = a_attitude.y;
  float yaw = a_placement.w;
  p.xy = rotate(p.xy, roll);
  n.xy = rotate(n.xy, roll);
  p.zy = rotate(p.zy, pitch);
  n.zy = rotate(n.zy, pitch);
  p.zx = rotate(p.zx, yaw);
  n.zx = rotate(n.zx, yaw);

  vec3 world = a_placement.xyz + p;
  v_worldPos = world;
  v_normal = n;
  v_color = a_color;
  v_backColor = a_backColor;
  gl_Position = u_viewProjection * vec4(world, 1.0);
}
