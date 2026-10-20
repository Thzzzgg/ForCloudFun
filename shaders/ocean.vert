#version 300 es
// 海面頂點：螢幕空間的「投影網格」投射到海平面，再加上四層 FFT 的位移
// 網格在畫面上分布均勻，近處細、遠處粗，一路延伸到地平線
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 a_grid;   // 網格座標 [0, 1]²

uniform mat4 u_viewProjection;
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec2 u_tanHalfFov;
uniform vec4 u_gridMap;        // (左右邊界 x, 底部 y, 頂部 y, 底部延伸區佔的比例)
uniform vec2 u_gridStep;
uniform float u_maxDistance;
uniform vec4 u_lengths;        // 四層海面區塊的邊長（公尺）
uniform float u_texSize;
uniform float u_maxLod;
uniform sampler2D u_displacement0;
uniform sampler2D u_displacement1;
uniform sampler2D u_displacement2;
uniform sampler2D u_displacement3;

out vec3 v_worldPos;
out vec2 v_restXZ;
out float v_height;

// 網格座標 → NDC。底部多延伸一段到畫面外，避免浪峰抬高時露出網格邊緣
vec2 gridToNdc(vec2 g) {
  float x = mix(-u_gridMap.x, u_gridMap.x, g.x);
  float y = g.y < u_gridMap.w
    ? mix(u_gridMap.y, -1.0, g.y / u_gridMap.w)
    : mix(-1.0, u_gridMap.z, (g.y - u_gridMap.w) / (1.0 - u_gridMap.w));
  return vec2(x, y);
}

vec3 projectToSea(vec2 g) {
  vec2 ndc = gridToNdc(g);
  vec3 dir = normalize(u_camForward + ndc.x * u_tanHalfFov.x * u_camRight + ndc.y * u_tanHalfFov.y * u_camUp);
  float horizontal = max(length(dir.xz), 1e-6);
  float dist = u_maxDistance;
  if (dir.y < -1e-6) dist = min(u_camPos.y / -dir.y * horizontal, u_maxDistance);
  vec2 xz = u_camPos.xz + dir.xz / horizontal * dist;
  return vec3(xz.x, 0.0, xz.y);
}

// 依網格間距挑選 mipmap 層級，遠處取平均值以免閃爍
vec3 displacementAt(sampler2D tex, vec2 xz, float patchSize, float cellSize) {
  float lod = clamp(log2(max(cellSize * u_texSize / patchSize, 1.0)), 0.0, u_maxLod);
  return textureLod(tex, xz / patchSize, lod).xyz;
}

void main() {
  vec3 rest = projectToSea(a_grid);
  vec3 neighborX = projectToSea(a_grid + vec2(u_gridStep.x, 0.0));
  vec3 neighborY = projectToSea(a_grid + vec2(0.0, u_gridStep.y));
  float cellSize = max(distance(rest, neighborX), distance(rest, neighborY));

  vec3 displacement = displacementAt(u_displacement0, rest.xz, u_lengths.x, cellSize)
    + displacementAt(u_displacement1, rest.xz, u_lengths.y, cellSize)
    + displacementAt(u_displacement2, rest.xz, u_lengths.z, cellSize)
    + displacementAt(u_displacement3, rest.xz, u_lengths.w, cellSize);

  vec3 world = rest + displacement;
  v_worldPos = world;
  v_restXZ = rest.xz;
  v_height = displacement.y;
  gl_Position = u_viewProjection * vec4(world, 1.0);
}
