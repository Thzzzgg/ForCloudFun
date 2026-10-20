#version 300 es
// 每幀合成「含雲的天空」經緯度貼圖：預先計算的大氣 + 隨風飄移的雲 + 低能見度的霧
// 海面反射、環境光、遠處的霧與自動曝光都從這張貼圖取樣（天空背景另外以全解析度繪製）
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

in vec2 v_uv;

uniform sampler2D u_atmosphere;
uniform vec3 u_camPos;
uniform vec3 u_cloudLightDir;
uniform vec3 u_cloudLightColor;
uniform float u_hazeDepth;   // 能見度低於晴天時多出來的霧（天頂方向的光學深度）

out vec4 fragColor;

void main() {
  vec3 dir = skyUVToDir(v_uv);
  vec3 color = textureLod(u_atmosphere, v_uv, 0.0).rgb;
  color = applyClouds(color, u_camPos, dir, u_cloudLightDir, u_cloudLightColor, skyAmbient(u_atmosphere));
  // 霧：越接近地平線，穿過的霧層越厚
  vec3 fogColor = sampleSky(u_atmosphere, normalize(vec3(dir.x, 0.0, dir.z)), 1.0);
  color = mix(color, fogColor, 1.0 - exp(-u_hazeDepth / max(dir.y, 0.03)));
  fragColor = vec4(color, 1.0);
}
