// 浮標的共用函式，由 JS 端的 #include 前處理插入
// - buoy.vert：依海面的位移與坡度擺放浮標
// - ocean.frag：浮標在海面上的倒影，用幾個直立圓柱近似 js/buoy.js 的剖面，顏色依高度決定

// 浮標的座標系：依海面法線傾斜，但只跟著 85%，看起來比較穩
mat3 buoyBasis(vec4 derivatives) {
  vec2 slope = derivatives.xy / max(1.0 + derivatives.zw, vec2(0.25));
  vec3 up = normalize(vec3(-slope.x, 1.0, -slope.y));
  up = normalize(mix(vec3(0.0, 1.0, 0.0), up, 0.85));
  vec3 forward = normalize(cross(vec3(1.0, 0.0, 0.0), up));
  vec3 right = cross(up, forward);
  return mat3(right, up, forward);
}

const float BUOY_RADIUS = 0.92; // 吃水線處的半徑（公尺）

// 浮標在高度 y（以吃水線為 0）的顏色，對應 js/buoy.js 的剖面；w = 1 表示會發光的燈號
vec4 buoyColorAt(float y) {
  const vec3 hull = vec3(0.03, 0.03, 0.035);
  const vec3 red = vec3(0.5, 0.03, 0.02);
  const vec3 white = vec3(0.75, 0.75, 0.72);
  const vec3 metal = vec3(0.25, 0.25, 0.26);
  if (y < 0.0) return vec4(hull, 0.0);
  if (y < 0.18) return vec4(red, 0.0);
  if (y < 0.32) return vec4(white, 0.0);
  if (y < 1.0) return vec4(red, 0.0);
  if (y < 1.3) return vec4(white, 0.0);
  if (y < 1.86) return vec4(red, 0.0);
  if (y < 1.96) return vec4(metal, 0.0);
  if (y < 2.22) return vec4(0.6, 0.55, 0.4, 1.0);
  return vec4(metal, 0.0);
}

// 射線（浮標座標）與直立圓柱（半徑 r、高度 y0～y1，含頂面）的最近交點；t 比目前的 hitT 近時更新
void hitCylinder(vec3 origin, vec3 dir, float r, float y0, float y1, inout float hitT, inout vec3 normal) {
  float a = dot(dir.xz, dir.xz);
  float b = dot(origin.xz, dir.xz);
  float c = dot(origin.xz, origin.xz) - r * r;
  float disc = b * b - a * c;
  if (a > 1e-8 && disc >= 0.0) {
    float t = (-b - sqrt(disc)) / a;
    float y = origin.y + dir.y * t;
    if (t > 0.0 && t < hitT && y >= y0 && y <= y1) {
      hitT = t;
      vec2 p = origin.xz + dir.xz * t;
      normal = vec3(p.x, 0.0, p.y) / r;
    }
  }
  if (abs(dir.y) > 1e-6) {
    float t = (y1 - origin.y) / dir.y;
    vec2 p = origin.xz + dir.xz * t;
    if (t > 0.0 && t < hitT && dot(p, p) <= r * r) {
      hitT = t;
      normal = vec3(0.0, 1.0, 0.0);
    }
  }
}

// 從海面往反射方向找浮標：擊中時回傳 true，並給出擊中處的高度（浮標座標）與世界座標的法線
// 先用外接圓柱排除大部分的像素，只有可能照到浮標的地方才細算
bool traceBuoy(vec3 origin, vec3 dir, vec3 center, mat3 basis, out float height, out vec3 normal) {
  vec3 o = (origin - center) * basis; // basis 是正交矩陣，右乘等於乘上反矩陣
  vec3 d = dir * basis;
  float bound = 1e9;
  vec3 n;
  hitCylinder(o, d, 1.0, -0.5, 2.35, bound, n);
  if (bound >= 1e8 && dot(o.xz, o.xz) > 1.0) return false;
  float t = 1e9;
  hitCylinder(o, d, BUOY_RADIUS, -0.5, 0.5, t, n); // 浮體
  hitCylinder(o, d, 0.27, 0.5, 1.96, t, n);        // 桅桿
  hitCylinder(o, d, 0.12, 1.96, 2.3, t, n);        // 燈號
  if (t >= 1e8) return false;
  height = o.y + d.y * t;
  normal = basis * n;
  return true;
}
