// 大氣模型的共用參數與函式（長度單位：公里），由 JS 端的 #include 前處理插入，需先 include common.glsl
// 參考 Bruneton（2017）與 Hillaire（2020）：穿透率與多重散射先算成查找表，天空預先計算時查表即可
// uniform 由 js/sky.js 設定
uniform vec3 u_betaRayleigh;     // 散射係數（1/km）
uniform float u_betaMie;
uniform vec3 u_betaOzone;        // 臭氧只吸收不散射
uniform float u_rayleighHeight;  // 密度的高度尺度（km）
uniform float u_mieHeight;
uniform float u_mieG;
uniform float u_earthRadius;
uniform float u_atmosphereRadius;

const vec2 TRANSMITTANCE_SIZE = vec2(256.0, 64.0);
const float MULTI_SCATTERING_SIZE = 32.0;

// 臭氧集中在 10～40 公里高，25 公里處最濃
float ozoneDensity(float h) {
  return max(1.0 - abs(h - 25.0) / 15.0, 0.0);
}

// 高度 h 的 (Rayleigh, Mie, 臭氧) 相對密度
vec3 densities(float h) {
  return vec3(exp(-h / u_rayleighHeight), exp(-h / u_mieHeight), ozoneDensity(h));
}

// 消光係數：散射加上吸收（Mie 有一成被吸收，臭氧全部吸收）
vec3 extinctionOf(vec3 density) {
  return u_betaRayleigh * density.x + u_betaMie * 1.1 * density.y + u_betaOzone * density.z;
}

float rayleighPhase(float nu) {
  return 3.0 / (16.0 * PI) * (1.0 + nu * nu);
}

// Cornette-Shanks 相位函數
float miePhase(float nu) {
  float g = u_mieG;
  return 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + nu * nu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * nu, 1.5));
}

// 以下 r 為與地心的距離、mu 為射線與天頂夾角的餘弦；(r - R)(r + R) 的寫法在地表附近比較精確
bool hitsGround(float r, float mu) {
  return mu < 0.0 && r * r * mu * mu - (r - u_earthRadius) * (r + u_earthRadius) >= 0.0;
}

float distanceToGround(float r, float mu) {
  return -r * mu - sqrt(max(r * r * mu * mu - (r - u_earthRadius) * (r + u_earthRadius), 0.0));
}

float distanceToTop(float r, float mu) {
  return max(-r * mu + sqrt(max(r * r * mu * mu + (u_atmosphereRadius - r) * (u_atmosphereRadius + r), 0.0)), 0.0);
}

// 查找表座標與 [0, 1] 之間的換算：讓 0 和 1 落在邊緣像素的中心
float toTexel(float x, float size) {
  return 0.5 / size + x * (1.0 - 1.0 / size);
}

float fromTexel(float u, float size) {
  return (u - 0.5 / size) / (1.0 - 1.0 / size);
}

// 穿透率查找表的參數化（Bruneton 2017）：天頂到地平線之間，越接近地平線解析度越高
vec2 transmittanceUV(float r, float mu) {
  float top = sqrt((u_atmosphereRadius - u_earthRadius) * (u_atmosphereRadius + u_earthRadius));
  float rho = sqrt(max((r - u_earthRadius) * (r + u_earthRadius), 0.0));
  float d = distanceToTop(r, mu);
  float dMin = u_atmosphereRadius - r;
  float dMax = rho + top;
  return vec2(toTexel((d - dMin) / (dMax - dMin), TRANSMITTANCE_SIZE.x), toTexel(rho / top, TRANSMITTANCE_SIZE.y));
}

// 從大氣中一點往 mu 方向穿出大氣層的穿透率；被地球擋住（在地球陰影裡）時為 0
vec3 transmittanceToTop(sampler2D lut, float r, float mu) {
  if (hitsGround(r, mu)) return vec3(0.0);
  return textureLod(lut, transmittanceUV(r, mu), 0.0).rgb;
}

// 多重散射查找表：橫軸為太陽天頂角的餘弦，縱軸為高度
vec2 multiScatteringUV(float r, float muSun) {
  float height = clamp((r - u_earthRadius) / (u_atmosphereRadius - u_earthRadius), 0.0, 1.0);
  return vec2(toTexel(muSun * 0.5 + 0.5, MULTI_SCATTERING_SIZE), toTexel(height, MULTI_SCATTERING_SIZE));
}
