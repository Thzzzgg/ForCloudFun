// 太陽與月亮的位置：北回歸線（北緯 23.5°，嘉義、花蓮一帶）春分那天的天空
// 時間以小時表示（0～24）；場景中的 -Z 方向（預設鏡頭朝向）是西南方，下午的太陽在畫面右前方
// 方向向量的定義與攝影機的 yaw 一致：-Z 為 0，往右為正

const DEG = Math.PI / 180;
const LATITUDE = 23.5 * DEG;
const VIEW_COMPASS = 225 * DEG; // 場景 -Z 方向的羅盤方位（西南）
const MOON_TRANSIT = 18; // 上弦月：傍晚 6 點通過正南方，午夜前後落入西方海面

// 赤緯 0 的天體在時角 hourAngle（正午為 0、往西為正）時的仰角與羅盤方位角（由北往東量）
function horizontal(hourAngle) {
  const sinElevation = Math.cos(LATITUDE) * Math.cos(hourAngle);
  const elevation = Math.asin(sinElevation);
  const cosAzimuth = (-sinElevation * Math.sin(LATITUDE)) / Math.max(Math.cos(elevation) * Math.cos(LATITUDE), 1e-9);
  let azimuth = Math.acos(Math.min(Math.max(cosAzimuth, -1), 1));
  if (Math.sin(hourAngle) > 0) azimuth = 2 * Math.PI - azimuth; // 下午（時角為正）在西邊
  return { elevation, azimuth };
}

function sceneDirection({ elevation, azimuth }) {
  const relative = azimuth - VIEW_COMPASS;
  return [Math.sin(relative) * Math.cos(elevation), Math.sin(elevation), -Math.cos(relative) * Math.cos(elevation)];
}

const hourAngle = (hours, transit) => (hours - transit) * 15 * DEG;

export function sunDirection(hours) {
  return sceneDirection(horizontal(hourAngle(hours, 12)));
}

export function moonDirection(hours) {
  return sceneDirection(horizontal(hourAngle(hours, MOON_TRANSIT)));
}

// 天球的周日運動：太陽、月亮與星星都繞著北天極（正北方、仰角等於緯度）由東往西轉
// 回傳 hours 時刻的旋轉矩陣（3×3、行優先，可直接當 mat3 uniform）：午夜時的天球方向乘上它就是此刻的方向
const POLE = sceneDirection({ elevation: LATITUDE, azimuth: 0 });

export function skyRotation(hours) {
  const angle = -hourAngle(hours, 0);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = POLE;
  // Rodrigues 旋轉公式
  return [
    c + (1 - c) * x * x, (1 - c) * y * x + s * z, (1 - c) * z * x - s * y,
    (1 - c) * x * y - s * z, c + (1 - c) * y * y, (1 - c) * z * y + s * x,
    (1 - c) * x * z + s * y, (1 - c) * y * z - s * x, c + (1 - c) * z * z,
  ];
}

// 羅盤方位與仰角（度），供測試與顯示使用
export function sunHorizontal(hours) {
  const { elevation, azimuth } = horizontal(hourAngle(hours, 12));
  return { elevation: elevation / DEG, azimuth: azimuth / DEG };
}

// 時段名稱：依太陽仰角區分，日出與日落前後 6° 稱為清晨、黃昏
export function periodName(hours) {
  const { elevation } = sunHorizontal(hours);
  if (elevation < -6) return '夜晚';
  if (elevation < 6) return hours < 12 ? '清晨' : '黃昏';
  if (hours >= 11 && hours <= 13) return '中午';
  return hours < 12 ? '上午' : '下午';
}

export function formatTime(hours) {
  const minutes = Math.round((((hours % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
