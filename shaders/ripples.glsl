// 點擊水面產生的漣漪與水花泡沫（js/ripples.js 的 rippleAt 是同一個式子，給單元測試用）
// 深水重力波的色散讓一個點的擾動散成一圈圈的環：距離 r、經過 t 秒時，主要是群速度等於 r / t 的波數
// k = g t² / (4 r²)，水面高度 η ≈ −A a² · exp(−k² a² / 4) · k^(5/4) / √(r t √g) · cos(k r)
// 漣漪只有幾公分高，只改變法線、不移動海面

const int MAX_RIPPLES = 8;          // 需與 js/ripples.js 一致
const float RIPPLE_LIFE = 15.0;     // 秒，需與 js/ripples.js 一致
const float RIPPLE_RADIUS = 0.4;    // 初始凹陷的半徑（公尺），需與 js/ripples.js 一致
const float RIPPLE_GRAVITY = 9.81;
const float SPLASH_FOAM_LIFE = 4.0; // 落水處的白色泡沫維持的秒數
const float MAX_RIPPLE_SLOPE = 0.4;  // 漣漪坡度的上限

// offset：與漣漪中心的水平距離（海面的靜止座標）；age：經過的秒數；depth：初始凹陷的深度（公尺）；
// pixel：一個像素在海面上的大小（公尺）
// 回傳 (∂η/∂x, ∂η/∂z, 落水處的泡沫量, 解析度不足而被抹平的坡度變異)
vec4 ripple(vec2 offset, float age, float depth, float pixel) {
  float r = max(length(offset), 1e-3);
  float t = max(age, 1e-3);
  // 落水處的泡沫：一團白色泡沫慢慢擴大、消散
  float foamRadius = 0.6 + 0.4 * t;
  float foam = (1.0 - smoothstep(0.4, 1.0, r / foamRadius)) * max(1.0 - t / SPLASH_FOAM_LIFE, 0.0);
  // 跑在最前面的長波振幅很小：距離超過 1.6 t 公尺時，坡度不到最大值的 2%，直接略過以節省運算
  if (r > 1.6 * t + 1.5) return vec4(0.0, 0.0, foam, 0.0);

  float a = RIPPLE_RADIUS;
  float k = RIPPLE_GRAVITY * t * t / (4.0 * r * r);
  float amplitude = depth * a * a * exp(-0.25 * k * k * a * a) * pow(k, 1.25) / sqrt(r * t * sqrt(RIPPLE_GRAVITY));
  // 剛落水時近似解不準（那一瞬間有水花擋著），淡入；生命的最後幾秒淡出
  amplitude *= smoothstep(0.0, 0.4, t) * (1.0 - smoothstep(RIPPLE_LIFE - 4.0, RIPPLE_LIFE, t));
  // 剛落水頭一兩秒、靠近中心的漣漪坡度很大，實際上這麼陡的水面早已碎成水花；壓到上限以下，
  // 免得出現一圈刺眼的反光（只壓最陡的部分，之後的漣漪幾乎不受影響）
  float steepness = amplitude * k;
  float excess = steepness / MAX_RIPPLE_SLOPE;
  steepness /= sqrt(sqrt(1.0 + excess * excess * excess * excess));
  // 波長只剩幾個像素時改用粗糙度表現，避免遠處閃爍
  float resolved = smoothstep(2.0, 4.0, 6.2831853 / (k * max(pixel, 1e-4)));
  float slope = -steepness * sin(k * r) * resolved;
  float variance = (1.0 - resolved) * 0.5 * steepness * steepness;
  return vec4(offset / r * slope, foam, variance);
}
