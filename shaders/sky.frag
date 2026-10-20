#version 300 es
// 天空背景：預先計算的大氣 + 星空 + 月亮（依太陽方向畫出盈虧）+ 太陽 + 雲 + 霧
precision highp float;
precision highp sampler2D;

#include "common.glsl"
#include "clouds.glsl"

in vec2 v_uv;

uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec2 u_tanHalfFov;
uniform vec3 u_camPos;
uniform sampler2D u_atmosphere;  // 預先計算的大氣（不含雲）
uniform sampler2D u_sky;         // 含雲的天空，用來決定曝光
uniform vec3 u_sunDir;           // 太陽方向（月亮的盈虧也用它，所以在地平線下也要正確）
uniform vec3 u_sunDisc;          // 太陽穿過大氣後的光，在地平線下為 0
uniform vec3 u_moonDir;
uniform vec3 u_moonTint;         // 月光穿過大氣的穿透率，在地平線下為 0
uniform mat3 u_starRotation;     // 天球的周日運動（js/celestial.js 的 skyRotation）
uniform vec3 u_cloudLightDir;
uniform vec3 u_cloudLightColor;
uniform float u_hazeDepth;       // 能見度低於晴天時多出來的霧（天頂方向的光學深度）
uniform float u_time;

out vec4 fragColor;

const float SUN_RADIUS = 0.0065;        // 太陽圓盤的角半徑（弧度，略大於實際值）
const float SUN_DISC_RADIANCE = 1500.0;
const float MOON_RADIUS = 0.0085;       // 月亮的角半徑（比實際大一些，比較好看見）
const float MOON_DISPLAY = 1.6;         // 月亮在畫面上的亮度，會依曝光部分補償
const float STAR_DISPLAY = 1.4;         // 星星在畫面上的亮度（不隨曝光改變）
const float STAR_GRID = 140.0;
const float STAR_PROBABILITY = 0.06;

// 星空：把天球投影到立方體的六個面、切成格子，部分格子放一顆亮度隨機的星
// pixelAngle 為一個像素對應的角度，讓星星在任何解析度下都約一個像素大
float starField(vec3 dir, float pixelAngle) {
  vec3 a = abs(dir);
  float major = max(max(a.x, a.y), a.z);
  vec2 face;
  float faceId;
  if (a.x >= a.y && a.x >= a.z) {
    face = dir.yz / a.x;
    faceId = dir.x > 0.0 ? 1.0 : 2.0;
  } else if (a.y >= a.z) {
    face = dir.xz / a.y;
    faceId = dir.y > 0.0 ? 3.0 : 4.0;
  } else {
    face = dir.xy / a.z;
    faceId = dir.z > 0.0 ? 5.0 : 6.0;
  }
  vec2 grid = face * STAR_GRID + faceId * 1000.0;
  vec2 cell = floor(grid);
  if (cloudHash(cell) > STAR_PROBABILITY) return 0.0;
  vec2 center = 0.2 + 0.6 * vec2(cloudHash(cell + 17.0), cloudHash(cell + 43.0));
  float pixel = max(pixelAngle * STAR_GRID / major, 1e-4);
  float d = length(grid - cell - center) / pixel;
  float magnitude = cloudHash(cell + 71.0);
  float brightness = 0.06 + 0.94 * pow(magnitude, 12.0); // 大多數暗、少數很亮
  float twinkle = 0.8 + 0.2 * sin(u_time * (1.5 + 3.0 * magnitude) + magnitude * 50.0);
  return brightness * twinkle * (1.0 - smoothstep(0.4, 1.2, d));
}

// 月亮：重建球面法線，用太陽方向決定亮的部分（上弦月時亮一半），表面加上較暗的月海
vec3 moonColor(vec3 dir, float exposure) {
  if (dot(dir, u_moonDir) < cos(MOON_RADIUS * 1.3)) return vec3(0.0);
  vec3 right = normalize(cross(u_moonDir, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, u_moonDir);
  vec2 q = vec2(dot(dir, right), dot(dir, up)) / MOON_RADIUS;
  float r2 = dot(q, q);
  float edge = 1.0 - smoothstep(0.9, 1.05, sqrt(r2));
  if (edge <= 0.0) return vec3(0.0);
  vec3 normal = normalize(q.x * right + q.y * up - sqrt(max(1.0 - r2, 0.0)) * u_moonDir);
  float lit = max(dot(normal, u_sunDir), 0.0);
  float maria = smoothstep(0.45, 0.62, cloudFbm(q * 1.3 + 4.0, 4));
  // 除以 √曝光：白天看得到淡淡的月亮，夜晚也不會亮到刺眼
  return u_moonTint * (MOON_DISPLAY / sqrt(exposure)) * (1.0 - 0.35 * maria) * (lit + 0.015) * edge;
}

void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 dir = normalize(u_camForward + ndc.x * u_tanHalfFov.x * u_camRight + ndc.y * u_tanHalfFov.y * u_camUp);
  // 螢幕導數要在進入任何分支之前計算
  float pixelAngle = length(fwidth(dir));
  vec3 color = sampleSky(u_atmosphere, normalize(vec3(dir.x, max(dir.y, 0.0), dir.z)), 0.0);
  float exposure = autoExposure(u_sky);

  // 太陽落到地平線下、天空也夠暗時才看得見星星（月亮附近較少），接近地平線時被大氣吸收；
  // 星星貼在天球上，隨時間東升西落
  float darkness = (1.0 - smoothstep(-0.17, -0.03, u_sunDir.y))
    * (1.0 - smoothstep(0.02, 0.12, luminance(color) * exposure));
  if (dir.y > 0.0 && darkness > 0.0) {
    float stars = starField(dir * u_starRotation, pixelAngle); // dir * M 等於乘上反向旋轉
    color += stars * (STAR_DISPLAY / exposure) * darkness * smoothstep(0.0, 0.12, dir.y);
  }
  color += moonColor(dir, exposure);

  float sunAngle = acos(clamp(dot(dir, u_sunDir), -1.0, 1.0));
  float disc = 1.0 - smoothstep(SUN_RADIUS * 0.85, SUN_RADIUS * 1.15, sunAngle);
  color += u_sunDisc * disc * SUN_DISC_RADIANCE;

  color = applyClouds(color, u_camPos, dir, u_cloudLightDir, u_cloudLightColor, skyAmbient(u_atmosphere));

  // 霧：越接近地平線，穿過的霧層越厚
  vec3 fogColor = sampleSky(u_atmosphere, normalize(vec3(dir.x, 0.0, dir.z)), 1.0);
  color = mix(color, fogColor, 1.0 - exp(-u_hazeDepth / max(dir.y, 0.03)));
  fragColor = vec4(color, 1.0);
}
