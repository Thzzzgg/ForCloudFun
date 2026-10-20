// 雲層：高度 1500 公尺的一層雲，以 fBm 噪音產生形狀，隨風飄移
// 由 JS 端的 #include 前處理插入，需先 include common.glsl；uniform 由 js/sky.js 的 setEnvironmentUniforms 設定
uniform float u_cloudCoverage;   // 0 = 晴朗，1 = 陰天
uniform float u_cloudThreshold;  // 由雲量換算的噪音門檻（js/weather.js）
uniform vec2 u_cloudOffset;      // 雲隨風飄移的累積距離（公尺）

const float CLOUD_HEIGHT = 1500.0;
const float CLOUD_SCALE = 1.0 / 2400.0; // 雲團大小約 2～3 公里
const float CLOUD_SOFTNESS = 0.15;
const float CLOUD_FADE_START = 7000.0;  // 遠處的雲漸漸換成平均密度
const float CLOUD_FADE_END = 26000.0;
const float CLOUD_HAZE = 1.0 / 60000.0; // 雲的大氣透視（1/公尺）

// 整數雜湊（Inigo Quilez）：雲飄得很遠、座標很大時仍然均勻，不會出現條紋
float cloudHash(vec2 cell) {
  uvec2 x = uvec2(ivec2(cell));
  uvec2 q = 1103515245u * ((x >> 1u) ^ x.yx);
  uint n = 1103515245u * (q.x ^ (q.y >> 3u));
  return float(n) * (1.0 / 4294967295.0);
}

float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = cloudHash(i);
  float b = cloudHash(i + vec2(1.0, 0.0));
  float c = cloudHash(i + vec2(0.0, 1.0));
  float d = cloudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 疊加 octaves 層噪音再除以振幅總和，層數不同時數值分布也大致相同
float cloudFbm(vec2 p, int octaves) {
  const mat2 ROTATE = mat2(0.8, 0.6, -0.6, 0.8);
  float sum = 0.0;
  float total = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < octaves; i++) {
    sum += amplitude * cloudNoise(p);
    total += amplitude;
    p = ROTATE * p * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return sum / total;
}

// 雲層的噪音值超過門檻多少：大於 0 的地方有雲，越大雲越厚
// 先用低頻噪音扭曲座標，雲的形狀比較自然；octaves 較少時只有大致的形狀，用在雲影與遮蔽，比較省效能
float cloudExcess(vec2 xz, int octaves) {
  vec2 p = (xz - u_cloudOffset) * CLOUD_SCALE;
  vec2 warp = vec2(cloudFbm(p * 0.5 + 5.2, 2), cloudFbm(p * 0.5 + 1.7, 2)) - 0.5;
  return cloudFbm(p + warp * 0.8, octaves) - u_cloudThreshold;
}

// 雲的密度（0～1），邊緣柔和
float cloudDensity(vec2 xz, int octaves) {
  return smoothstep(0.0, CLOUD_SOFTNESS, cloudExcess(xz, octaves));
}

// 遠處的雲看不清形狀（也容易閃爍），在 CLOUD_FADE_START～END 之間漸漸換成平均密度（等於雲量）
// 掠射角看過去的雲層本來就比較密，地平線附近因此是一層朦朧的雲
float cloudLayerDensity(vec2 xz, float dist, int octaves) {
  float far = smoothstep(CLOUD_FADE_START, CLOUD_FADE_END, dist);
  if (far >= 1.0) return u_cloudCoverage;
  return mix(cloudDensity(xz, octaves), u_cloudCoverage, far);
}

// 在背景天色上疊加視線看到的雲。沿光源方向再取一次密度估計雲本身的遮蔽，越厚越暗；
// 靠近光源的薄雲邊緣因前向散射發亮（銀邊）；越遠的雲越融入背後的天色（大氣透視）
vec3 applyClouds(vec3 background, vec3 origin, vec3 dir, vec3 lightDir, vec3 lightColor, vec3 ambient) {
  if (u_cloudCoverage <= 0.001 || dir.y <= 0.0) return background;
  float dist = (CLOUD_HEIGHT - origin.y) / max(dir.y, 1e-4);
  vec2 xz = origin.xz + dir.xz * dist;
  // 遠處用平均值（見 cloudLayerDensity）；厚度讓陰天的雲層也有明暗變化
  float far = smoothstep(CLOUD_FADE_START, CLOUD_FADE_END, dist);
  float density = u_cloudCoverage;
  float thickness = u_cloudCoverage;
  if (far < 1.0) {
    float excess = cloudExcess(xz, 5);
    density = mix(smoothstep(0.0, CLOUD_SOFTNESS, excess), u_cloudCoverage, far);
    thickness = mix(smoothstep(0.0, 0.6, excess), u_cloudCoverage, far);
  }
  if (density <= 0.0) return background;

  vec2 towardLight = lightDir.xz / max(lightDir.y, 0.2) * 350.0;
  float occlusion = cloudLayerDensity(xz + towardLight, dist, 3);
  float direct = exp(-2.5 * occlusion) * (1.0 - 0.6 * thickness);
  float g = 0.6;
  float mu = dot(dir, lightDir);
  float phase = 0.25 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
  vec3 skyLight = mix(ambient, vec3(luminance(ambient)), 0.5);
  vec3 color = lightColor * direct * (0.08 + 0.04 * phase * (1.0 - density))
    + skyLight * mix(1.1, 0.5, thickness);
  color = mix(color, background, 1.0 - exp(-dist * CLOUD_HAZE));
  return mix(background, color, clamp(density * 1.15, 0.0, 1.0));
}

// 雲影：從海面往光源方向找到雲層上的點，依雲的密度遮掉直射光；光源很低時用平均密度，
// 和天空背景裡地平線附近的那層雲一致
float cloudShadow(vec3 worldPos, vec3 lightDir) {
  if (u_cloudCoverage <= 0.001 || lightDir.y <= 0.0) return 1.0;
  float dist = (CLOUD_HEIGHT - worldPos.y) / lightDir.y;
  return 1.0 - 0.95 * cloudLayerDensity(worldPos.xz + lightDir.xz * dist, dist, 3);
}
