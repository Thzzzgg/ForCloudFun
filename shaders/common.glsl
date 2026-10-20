// 共用常數與函式，由 JS 端的 #include 前處理插入各 shader

const float PI = 3.14159265358979;

// 天空經緯度貼圖座標：u 對應方位角，v 對應仰角的平方根（讓地平線附近有較高解析度）
vec2 skyDirToUV(vec3 d) {
  float elevation = asin(clamp(d.y, 0.0, 1.0));
  float azimuth = atan(d.x, -d.z + 1e-7);
  return vec2(azimuth / (2.0 * PI) + 0.5, sqrt(elevation / (0.5 * PI)));
}

vec3 skyUVToDir(vec2 uv) {
  float azimuth = (uv.x - 0.5) * 2.0 * PI;
  float elevation = uv.y * uv.y * 0.5 * PI;
  return vec3(sin(azimuth) * cos(elevation), sin(elevation), -cos(azimuth) * cos(elevation));
}

vec3 sampleSky(sampler2D sky, vec3 dir, float lod) {
  return textureLod(sky, skyDirToUV(dir), lod).rgb;
}

// 天空的平均亮度（最小一層 mipmap），當作環境光
vec3 skyAmbient(sampler2D sky) {
  return textureLod(sky, vec2(0.5), 16.0).rgb;
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// 自動曝光：依天空平均亮度只做部分適應（指數 0.75），夜晚的畫面仍然比白天暗
// EXPOSURE_KEY 讓晴朗的下午 4 點曝光值約為 0.55
const float EXPOSURE_KEY = 0.365;
float autoExposure(sampler2D sky) {
  float lum = max(luminance(skyAmbient(sky)), 1e-7);
  return clamp(EXPOSURE_KEY * pow(lum, -0.75), 0.1, 45.0);
}

// 大氣透視：距離越遠越融入同方位的地平線天色
vec3 applyAerialPerspective(vec3 color, vec3 viewDir, float dist, sampler2D sky, float density) {
  vec3 horizonDir = normalize(vec3(viewDir.x, 0.0, viewDir.z));
  vec3 fogColor = sampleSky(sky, horizonDir, 1.0);
  return mix(color, fogColor, 1.0 - exp(-dist * density));
}
