#version 300 es
// 整理 IFFT 結果成渲染用的貼圖，並以 Jacobian 追蹤白浪泡沫
precision highp float;
precision highp sampler2D;

uniform sampler2D u_fieldA;            // (Dx, h, Dz, ∂h/∂x)
uniform sampler2D u_fieldB;            // (∂h/∂z, ∂Dx/∂x, ∂Dz/∂z, ∂Dx/∂z)
uniform sampler2D u_prevDisplacement;  // 上一幀的位移貼圖（取 alpha 的紊流值）
uniform float u_choppiness;            // 水平位移強度 λ，越大浪尖越尖
uniform float u_deltaTime;
uniform float u_foamRecovery;          // 泡沫消散速度

layout(location = 0) out vec4 outDisplacement;   // (λDx, h, λDz, 紊流值)
layout(location = 1) out vec4 outDerivatives;    // (∂h/∂x, ∂h/∂z, λ∂Dx/∂x, λ∂Dz/∂z)
layout(location = 2) out vec4 outSlopeVariance;  // (|∇h|², 0, 0, 1)：mipmap 後用來估計遠處的粗糙度

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(u_fieldA, p, 0);
  vec4 b = texelFetch(u_fieldB, p, 0);
  float dxx = u_choppiness * b.y;
  float dzz = u_choppiness * b.z;
  float dxz = u_choppiness * b.w;

  // Jacobian 小於 1 代表海面被擠壓（浪頭），小於 0 代表浪捲起來
  float jacobian = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  // 紊流值會立刻跟著 Jacobian 下降，之後再慢慢回升，形成殘留的泡沫
  float previous = texelFetch(u_prevDisplacement, p, 0).a;
  float turbulence = min(jacobian, previous + u_deltaTime * u_foamRecovery / max(jacobian, 0.5));

  outDisplacement = vec4(u_choppiness * a.x, a.y, u_choppiness * a.z, turbulence);
  outDerivatives = vec4(a.w, b.x, dxx, dzz);
  outSlopeVariance = vec4(a.w * a.w + b.x * b.x, 0.0, 0.0, 1.0);
}
