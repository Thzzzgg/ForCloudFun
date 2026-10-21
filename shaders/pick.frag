#version 300 es
// 點擊水面：沿著視線往前走，找出第一個碰到的海面（含水平位移的浪形），供 CPU 非同步讀回
// 輸出 (靜止 x, 靜止 z, 海面高度, 沿視線的距離)；沒有碰到海面時距離為 -1
precision highp float;
precision highp sampler2D;

uniform vec3 u_origin;
uniform vec3 u_direction;        // 單位向量
uniform vec4 u_lengths;          // 四層海面區塊的邊長（公尺）
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;

out vec4 fragColor;

const int STEPS = 96;
const int REFINE = 16;
const float NEAR = 0.5;
const float FAR = 3000.0;

vec3 displacementAt(vec2 xz) {
  return textureLod(u_displacement0, xz / u_lengths.x, 0.0).xyz
    + textureLod(u_displacement1, xz / u_lengths.y, 0.0).xyz
    + textureLod(u_displacement2, xz / u_lengths.z, 0.0).xyz
    + textureLod(u_displacement3, xz / u_lengths.w, 0.0).xyz;
}

// 水平位置 p 正下方（或正上方）的海面：找出位移後剛好落在 p 的靜止位置，回傳 (靜止 x, 靜止 z, 海面高度)
vec3 surfaceAt(vec2 p) {
  vec2 rest = p;
  for (int i = 0; i < 4; i++) rest = p - displacementAt(rest).xz;
  return vec3(rest, displacementAt(rest).y);
}

bool underwater(float t) {
  vec3 point = u_origin + u_direction * t;
  return point.y < surfaceAt(point.xz).z;
}

void main() {
  fragColor = vec4(0.0, 0.0, 0.0, -1.0);
  // 往上看的視線碰不到海面；往下看時最遠走到比最深的浪谷再低一點的地方
  if (u_direction.y > -1e-4) return;
  float far = min(FAR, (u_origin.y + 15.0) / -u_direction.y);
  if (far <= NEAR) return;
  // 步長隨距離等比放大：近處走得細，遠處走得粗
  float previous = NEAR;
  for (int i = 1; i <= STEPS; i++) {
    float t = NEAR * pow(far / NEAR, float(i) / float(STEPS));
    if (underwater(t)) {
      // 在剛進入水面的這一段內二分搜尋
      float above = previous;
      float below = t;
      for (int j = 0; j < REFINE; j++) {
        float middle = 0.5 * (above + below);
        if (underwater(middle)) below = middle;
        else above = middle;
      }
      vec3 point = u_origin + u_direction * below;
      fragColor = vec4(surfaceAt(point.xz), below);
      return;
    }
    previous = t;
  }
}
