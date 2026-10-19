#version 300 es
// 全螢幕三角形：三個頂點由 gl_VertexID 產生，涵蓋整個畫面

out vec2 v_uv;

void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
