// 遠方的船：貨櫃船、帆船與漁船在幾公里外緩慢航行並隨浪搖晃，遠處被大氣透視淡化；
// 夜晚或起霧時亮起航行燈：桅燈、左舷紅燈、右舷綠燈、艉燈各只在規定的方位角內看得到
// ShipTraffic 與模型產生器不依賴 WebGL，Ships 負責繪製
import { setEnvironmentUniforms } from './sky.js';

const DEG = Math.PI / 180;
export const SHIP_FLOATS = 13; // 每個頂點：位置、法線、正面顏色、背面顏色、（未使用）

// 航線（世界座標 x, z，公尺）、航速（m/s）與一開始在航線上的位置（0～1）；走到終點後從起點重新出發
// 預設視角朝向 -z，貨櫃船在 6.5 公里外橫越太陽的反光，帆船與漁船在兩、三公里外
export const SHIP_ROUTES = [
  { type: 'container', from: [-15000, -6500], to: [15000, -6500], speed: 8, start: 0.44 },
  { type: 'sailboat', from: [3500, -1600], to: [-3500, -2100], speed: 2.8, start: 0.4 },
  { type: 'fishing', from: [-3000, -1800], to: [2000, -4900], speed: 3.5, start: 0.4 },
];

// 各種船隨浪搖晃的幅度（弧度，有效波高 2 公尺時）與週期（秒）；越小的船晃得越厲害
const MOTION = {
  container: { roll: [0.025, 13], pitch: [0.008, 8], heave: 0.25 },
  sailboat: { roll: [0.06, 5], pitch: [0.04, 4], heave: 0.45 },
  fishing: { roll: [0.07, 6.5], pitch: [0.035, 5], heave: 0.4 },
};

// 航行燈的顏色與在畫面上的亮度（與浮標燈號相同，除以自動曝光後固定）
const LIGHT_COLORS = {
  masthead: [1, 0.95, 0.85, 10],
  stern: [1, 0.95, 0.85, 8],
  port: [1, 0.08, 0.05, 10],
  starboard: [0.1, 1, 0.35, 10],
  window: [1, 0.75, 0.4, 3],
  deck: [1, 0.97, 0.9, 16],
};

// 開燈：日落後到日出前（太陽仰角低於約 3°），以及能見度低於 5 公里時
export function lightsOn({ sunElevation, visibility }) {
  return sunElevation < 0.05 || visibility < 5;
}

// 從船上看鏡頭的相對方位（弧度）：0 為正前方，正值在左舷（模型的 +x），負值在右舷
export function relativeBearing(ship, cameraPosition) {
  const dx = cameraPosition[0] - ship.position[0];
  const dz = cameraPosition[2] - ship.position[2];
  const forward = dx * Math.sin(ship.yaw) + dz * Math.cos(ship.yaw);
  const left = dx * Math.cos(ship.yaw) - dz * Math.sin(ship.yaw);
  return Math.atan2(left, forward);
}

// 這盞燈從這個方位看不看得到（國際海上避碰規則的照射範圍，左右各略放寬 3°）
export function lightVisible(kind, bearing) {
  const b = Math.abs(bearing);
  switch (kind) {
    case 'masthead': return b <= 112.5 * DEG;
    case 'port': return bearing >= -3 * DEG && bearing <= 112.5 * DEG;
    case 'starboard': return bearing <= 3 * DEG && bearing >= -112.5 * DEG;
    case 'stern': return b >= 112.5 * DEG;
    case 'window': return b <= 80 * DEG;
    default: return true;
  }
}

// 船隨航線前進與隨浪搖晃
export class ShipTraffic {
  constructor(routes = SHIP_ROUTES) {
    this.time = 0;
    this.ships = routes.map((route, i) => {
      const dx = route.to[0] - route.from[0];
      const dz = route.to[1] - route.from[1];
      return {
        ...route,
        length: Math.hypot(dx, dz),
        yaw: Math.atan2(dx, dz),
        phase: i * 2.3,
        position: [0, 0, 0],
        pitch: 0,
        roll: 0,
      };
    });
    this.update(0, { significantHeight: 1, windSpeed: 0 });
  }

  update(deltaTime, { significantHeight, windSpeed }) {
    this.time += deltaTime;
    const t = this.time;
    const severity = Math.min(significantHeight / 2, 2);
    for (const ship of this.ships) {
      const progress = (ship.start + (ship.speed * t) / ship.length) % 1;
      const motion = MOTION[ship.type];
      const wave = (amplitude, period, offset) => amplitude * severity * Math.sin((2 * Math.PI * t) / period + ship.phase + offset);
      ship.position = [
        ship.from[0] + (ship.to[0] - ship.from[0]) * progress,
        wave(motion.heave, MOTION[ship.type].pitch[1] * 1.3, 0.7),
        ship.from[1] + (ship.to[1] - ship.from[1]) * progress,
      ];
      ship.pitch = wave(...motion.pitch, 1.9);
      ship.roll = wave(...motion.roll, 0);
      // 帆船被風吹得往一側傾斜
      if (ship.type === 'sailboat') ship.roll -= 0.08 + 0.2 * Math.min(windSpeed / 20, 1);
    }
  }
}

// 船的姿態：模型座標（前方 +z、上方 +y、左舷 +x）先側傾、再俯仰、最後轉到航向，回傳變換函式
export function shipTransform({ position, yaw, pitch, roll }) {
  const [cr, sr, cp, sp, cy, sy] = [Math.cos(roll), Math.sin(roll), Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw)];
  const rotate = ([x, y, z]) => {
    [x, y] = [cr * x - sr * y, sr * x + cr * y];
    [z, y] = [cp * z - sp * y, sp * z + cp * y];
    [z, x] = [cy * z - sy * x, sy * z + cy * x];
    return [x, y, z];
  };
  return {
    rotate,
    apply: (p) => rotate(p).map((v, i) => v + position[i]),
    // column-major 的 4×4 矩陣，給頂點著色器用
    matrix() {
      const [ax, ay, az] = [rotate([1, 0, 0]), rotate([0, 1, 0]), rotate([0, 0, 1])];
      return new Float32Array([...ax, 0, ...ay, 0, ...az, 0, ...position, 1]);
    },
  };
}

// 模型產生器：累加三角形（每個頂點 13 個數），以及燈的位置
class MeshBuilder {
  constructor() {
    this.data = [];
    this.lights = [];
  }

  triangle(a, b, c, normal, color, back = color) {
    for (const p of [a, b, c]) this.data.push(...p, ...normal, ...color, ...back, 0);
  }

  quad(a, b, c, d, normal, color, back = color) {
    this.triangle(a, b, c, normal, color, back);
    this.triangle(a, c, d, normal, color, back);
  }

  box([x0, y0, z0], [x1, y1, z1], color) {
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], color);
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], color);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], color);
  }

  // 船身：甲板輪廓（方形船尾、尖船頭）往下延伸到吃水深度；吃水線以下塗成船底的顏色
  hull({ length, beam, depth, draft, bow, color, bottom }) {
    const half = beam / 2;
    const stern = -length / 2;
    const outline = [[half, stern], [half, length / 2 - bow], [0, length / 2], [-half, length / 2 - bow], [-half, stern]];
    outline.forEach(([x0, z0], i) => {
      const [x1, z1] = outline[(i + 1) % outline.length];
      const edge = Math.hypot(x1 - x0, z1 - z0);
      const normal = [(z1 - z0) / edge, 0, -(x1 - x0) / edge];
      this.quad([x0, -draft, z0], [x1, -draft, z1], [x1, 0, z1], [x0, 0, z0], normal, bottom);
      this.quad([x0, 0, z0], [x1, 0, z1], [x1, depth, z1], [x0, depth, z0], normal, color);
    });
    const deck = [0, depth, 0];
    outline.forEach(([x0, z0], i) => {
      const [x1, z1] = outline[(i + 1) % outline.length];
      this.triangle(deck, [x1, depth, z1], [x0, depth, z0], [0, 1, 0], DECK);
    });
  }

  // 航行燈：kind 決定顏色與照射範圍；燈稍微凸出物體表面，免得被自己擋住
  light(kind, position) {
    this.lights.push({ kind, position });
  }

  build() {
    return { geometry: new Float32Array(this.data), lights: this.lights };
  }
}

const DECK = [0.3, 0.28, 0.25];
const WHITE = [0.78, 0.78, 0.76];
const STEEL = [0.32, 0.33, 0.35];
const CONTAINER_COLORS = [
  [0.6, 0.22, 0.05], [0.06, 0.17, 0.38], [0.45, 0.07, 0.05], [0.4, 0.4, 0.42],
  [0.1, 0.3, 0.16], [0.7, 0.7, 0.68], [0.05, 0.3, 0.32], [0.55, 0.45, 0.1],
];

// 貨櫃船：長 180 公尺，船尾是白色的駕駛台與煙囪，甲板上堆滿各色貨櫃
function containerShip() {
  const mesh = new MeshBuilder();
  mesh.hull({ length: 180, beam: 28, depth: 14, draft: 10, bow: 24, color: [0.06, 0.09, 0.16], bottom: [0.32, 0.05, 0.04] });
  mesh.box([-12, 14, -78], [12, 38, -64], WHITE);
  mesh.box([-15, 34, -66], [15, 37, -63], WHITE);
  mesh.box([-3.5, 14, -86], [3.5, 40, -79], [0.4, 0.06, 0.05]);
  mesh.box([-0.5, 14, 74], [0.5, 26, 75], STEEL);
  // 貨櫃：每一排沿船寬分成三疊，顏色與高度各不相同（固定的排列，每次載入都一樣）
  let n = 0;
  for (let z = -58; z < 66; z += 12.5) {
    for (const [x0, x1] of [[-12, -4.2], [-4, 3.8], [4, 12]]) {
      const tiers = 3 + ((n * 7) % 4);
      mesh.box([x0, 14, z], [x1, 14 + tiers * 2.6, z + 12], CONTAINER_COLORS[(n * 5 + 3) % CONTAINER_COLORS.length]);
      n++;
    }
  }
  mesh.light('masthead', [0, 39, -63]);
  mesh.light('masthead', [0, 27, 75.5]);
  mesh.light('port', [15.5, 36, -64]);
  mesh.light('starboard', [-15.5, 36, -64]);
  mesh.light('stern', [0, 18, -90.5]);
  for (let i = 0; i < 6; i++) {
    for (const y of [24, 29]) mesh.light('window', [-9 + i * 3.6, y, -63.4]);
  }
  return mesh.build();
}

// 帆船：長 12 公尺，白色船身、一根桅杆與兩面三角帆
function sailboat() {
  const mesh = new MeshBuilder();
  mesh.hull({ length: 12, beam: 3.8, depth: 1.2, draft: 1.5, bow: 3.5, color: [0.82, 0.82, 0.8], bottom: [0.05, 0.08, 0.18] });
  mesh.box([-1.2, 1.2, -2.5], [1.2, 1.9, 1.5], WHITE);
  mesh.box([-0.08, 1.2, 0.9], [0.08, 16, 1.1], STEEL);
  const sail = [0.9, 0.9, 0.88];
  mesh.triangle([0, 2.2, 0.9], [0, 15.5, 0.95], [0, 2.2, -4.2], [1, 0, 0], sail);
  mesh.triangle([0, 1.5, 5.6], [0, 13.5, 1.15], [0, 1.6, 1.3], [1, 0, 0], sail);
  mesh.light('port', [1, 1.5, 4.6]);
  mesh.light('starboard', [-1, 1.5, 4.6]);
  mesh.light('stern', [0, 1.4, -6.1]);
  return mesh.build();
}

// 漁船：長 24 公尺，前段是白色的駕駛室，後面有起網用的門形架；夜晚甲板燈很亮
function fishingBoat() {
  const mesh = new MeshBuilder();
  mesh.hull({ length: 24, beam: 7, depth: 2.8, draft: 2.5, bow: 5, color: [0.08, 0.14, 0.32], bottom: [0.3, 0.06, 0.05] });
  mesh.box([-2.4, 2.8, 2], [2.4, 6.5, 7], WHITE);
  mesh.box([-0.15, 6.5, 5.5], [0.15, 12, 5.8], STEEL);
  mesh.box([-2.9, 2.8, -9.2], [-2.5, 9.5, -8.8], STEEL);
  mesh.box([2.5, 2.8, -9.2], [2.9, 9.5, -8.8], STEEL);
  mesh.box([-2.9, 9.1, -9.2], [2.9, 9.5, -8.8], STEEL);
  mesh.light('masthead', [0, 12.3, 5.65]);
  mesh.light('port', [2.6, 5.5, 6]);
  mesh.light('starboard', [-2.6, 5.5, 6]);
  mesh.light('stern', [0, 3.2, -12.2]);
  mesh.light('deck', [0, 9.8, -9]);
  mesh.light('window', [-1.2, 5.2, 7.2]);
  mesh.light('window', [1.2, 5.2, 7.2]);
  return mesh.build();
}

export const SHIP_MODELS = { container: containerShip, sailboat, fishing: fishingBoat };

// 繪製：每艘船一個 VAO；航行燈以點的方式畫在最後，亮度固定、不受曝光影響
export class Ships {
  constructor(gl, programs) {
    this.gl = gl;
    this.programs = programs;
    this.traffic = new ShipTraffic();
    this.models = {};
    for (const [type, build] of Object.entries(SHIP_MODELS)) {
      const { geometry, lights } = build();
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.STATIC_DRAW);
      [[0, 3, 0], [1, 3, 12], [2, 3, 24], [3, 3, 36]].forEach(([location, size, offset]) => {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, SHIP_FLOATS * 4, offset);
      });
      this.models[type] = { vao, buffer, vertexCount: geometry.length / SHIP_FLOATS, lights };
    }
    const maxLights = Object.values(this.models).reduce((sum, model) => sum + model.lights.length, 0);
    this.lightData = new Float32Array(maxLights * 7);
    this.lightCount = 0;
    this.lightVao = gl.createVertexArray();
    gl.bindVertexArray(this.lightVao);
    this.lightBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.lightData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // conditions：{ significantHeight, windSpeed, lights（是否開燈）}；camera 用來判斷每盞燈看不看得到
  update(deltaTime, { significantHeight, windSpeed, lights }, camera) {
    this.traffic.update(deltaTime, { significantHeight, windSpeed });
    this.lightCount = 0;
    if (!lights) return;
    for (const ship of this.traffic.ships) {
      const bearing = relativeBearing(ship, camera.position);
      const transform = shipTransform(ship);
      for (const light of this.models[ship.type].lights) {
        if (!lightVisible(light.kind, bearing)) continue;
        this.lightData.set([...transform.apply(light.position), ...LIGHT_COLORS[light.kind]], this.lightCount * 7);
        this.lightCount++;
      }
    }
  }

  draw({ camera, sky, environment, pointSize }) {
    const { gl } = this;
    const program = this.programs.ship.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_camPos', camera.position)
      .tex('u_sky', sky.texture, 0);
    setEnvironmentUniforms(program, environment);
    gl.enable(gl.DEPTH_TEST);
    for (const ship of this.traffic.ships) {
      const model = this.models[ship.type];
      program.set('u_model', shipTransform(ship).matrix());
      gl.bindVertexArray(model.vao);
      gl.drawArrays(gl.TRIANGLES, 0, model.vertexCount);
    }
    gl.bindVertexArray(null);
    if (!this.lightCount) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lightData, 0, this.lightCount * 7);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.programs.lights.use()
      .set('u_viewProjection', camera.viewProjection)
      .set('u_camPos', camera.position)
      .set('u_pointSize', pointSize)
      .set('u_fogDensity', environment.fogDensity)
      .tex('u_sky', sky.texture, 0);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.lightVao);
    gl.drawArrays(gl.POINTS, 0, this.lightCount);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}
