// 遠方的船：航線、搖晃、航行燈與模型的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { lightsOn, lightVisible, relativeBearing, SHIP_FLOATS, SHIP_MODELS, SHIP_ROUTES, ShipTraffic, shipTransform } from '../js/ships.js';

const DEG = Math.PI / 180;
const CALM = { significantHeight: 0.4, windSpeed: 3 };
const ROUGH = { significantHeight: 4.7, windSpeed: 18 };

test('船沿著航線以設定的航速前進，走到終點後從起點重新出發', () => {
  const traffic = new ShipTraffic();
  const before = traffic.ships.map((s) => [...s.position]);
  traffic.update(100, CALM);
  traffic.ships.forEach((ship, i) => {
    const moved = Math.hypot(ship.position[0] - before[i][0], ship.position[2] - before[i][2]);
    assert.ok(Math.abs(moved - ship.speed * 100) < 1e-6, `${ship.type} 100 秒走了 ${moved.toFixed(1)} m`);
    const forward = [Math.sin(ship.yaw), Math.cos(ship.yaw)];
    const direction = [ship.to[0] - ship.from[0], ship.to[1] - ship.from[1]].map((v) => v / ship.length);
    assert.ok(Math.abs(forward[0] - direction[0]) < 1e-9 && Math.abs(forward[1] - direction[1]) < 1e-9, '船頭朝著航線的方向');
  });
  // 走完一整趟再多走一點，又回到起點附近
  const container = traffic.ships[0];
  traffic.update(container.length / container.speed, CALM);
  const progress = (container.position[0] - container.from[0]) / (container.to[0] - container.from[0]);
  assert.ok(progress >= 0 && progress < 1);
});

test('浪越大船晃得越厲害；風越大帆船傾斜得越多', () => {
  const swing = (conditions, type) => {
    const traffic = new ShipTraffic();
    let roll = 0;
    let pitch = 0;
    const ship = traffic.ships.find((s) => s.type === type);
    for (let i = 0; i < 600; i++) {
      traffic.update(0.1, conditions);
      roll = Math.max(roll, Math.abs(ship.roll));
      pitch = Math.max(pitch, Math.abs(ship.pitch));
    }
    return { roll, pitch };
  };
  for (const type of ['container', 'fishing']) {
    assert.ok(swing(ROUGH, type).roll > 3 * swing(CALM, type).roll, `${type} 的橫搖`);
    assert.ok(swing(ROUGH, type).pitch > 3 * swing(CALM, type).pitch, `${type} 的縱搖`);
  }
  assert.ok(swing(ROUGH, 'fishing').roll > swing(ROUGH, 'container').roll, '小船晃得比大船厲害');
  assert.ok(swing({ ...CALM, windSpeed: 15 }, 'sailboat').roll > swing(CALM, 'sailboat').roll + 0.1, '帆船被風吹得傾斜');
});

test('日落後、日出前以及起霧時開航行燈', () => {
  assert.equal(lightsOn({ sunElevation: 0.5, visibility: 35 }), false);
  assert.equal(lightsOn({ sunElevation: -0.1, visibility: 35 }), true);
  assert.equal(lightsOn({ sunElevation: 0.02, visibility: 35 }), true, '太陽快下山時');
  assert.equal(lightsOn({ sunElevation: 0.5, visibility: 3 }), true, '白天起霧時');
});

test('相對方位：正前方為 0，左舷為正，右舷為負', () => {
  const ship = { position: [100, 0, 200], yaw: 90 * DEG }; // 船頭朝 +x，左舷朝 -z
  assert.ok(Math.abs(relativeBearing(ship, [500, 3, 200])) < 1e-9);
  assert.ok(Math.abs(relativeBearing(ship, [100, 3, -300]) - 90 * DEG) < 1e-9);
  assert.ok(Math.abs(relativeBearing(ship, [100, 3, 700]) + 90 * DEG) < 1e-9);
});

test('航行燈只在規定的方位角內看得到', () => {
  const at = (deg) => deg * DEG;
  // 正前方：桅燈與兩盞舷燈都看得到，看不到艉燈
  assert.deepEqual(['masthead', 'port', 'starboard', 'stern'].map((k) => lightVisible(k, at(0))), [true, true, true, false]);
  // 左舷正橫：看得到紅燈，看不到綠燈
  assert.equal(lightVisible('port', at(90)), true);
  assert.equal(lightVisible('starboard', at(90)), false);
  // 右舷正橫：看得到綠燈，看不到紅燈
  assert.equal(lightVisible('starboard', at(-90)), true);
  assert.equal(lightVisible('port', at(-90)), false);
  // 正後方：只看得到艉燈
  assert.deepEqual(['masthead', 'port', 'starboard', 'stern'].map((k) => lightVisible(k, at(180))), [false, false, false, true]);
  // 112.5° 是舷燈與艉燈的分界
  assert.equal(lightVisible('port', at(110)), true);
  assert.equal(lightVisible('port', at(115)), false);
  assert.equal(lightVisible('stern', at(115)), true);
  assert.equal(lightVisible('deck', at(180)), true, '甲板燈四周都看得到');
});

test('船的姿態：船頭轉到航向，側傾為正時左舷抬高，矩陣與變換一致', () => {
  const ship = { position: [10, 1, -20], yaw: 30 * DEG, pitch: 0, roll: 0 };
  const bow = shipTransform(ship).rotate([0, 0, 1]);
  assert.ok(Math.abs(bow[0] - Math.sin(30 * DEG)) < 1e-9 && Math.abs(bow[2] - Math.cos(30 * DEG)) < 1e-9);
  const port = shipTransform({ ...ship, yaw: 0, roll: 10 * DEG }).rotate([1, 0, 0]);
  assert.ok(port[1] > 0, '左舷抬高');
  const tilted = { ...ship, pitch: 5 * DEG, roll: -8 * DEG };
  const transform = shipTransform(tilted);
  const m = transform.matrix();
  const p = [3, 4, 5];
  const viaMatrix = [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
  transform.apply(p).forEach((v, i) => assert.ok(Math.abs(v - viaMatrix[i]) < 1e-4, '矩陣是 32 位元浮點數'));
});

test('船的模型：大小合理、法線為單位向量、每艘船都有航行燈', () => {
  const sizes = {};
  for (const [type, build] of Object.entries(SHIP_MODELS)) {
    const { geometry, lights } = build();
    assert.equal(geometry.length % (SHIP_FLOATS * 3), 0, `${type} 是完整的三角形`);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geometry.length; i += SHIP_FLOATS) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], geometry[i + k]);
        max[k] = Math.max(max[k], geometry[i + k]);
      }
      assert.ok(Math.abs(Math.hypot(geometry[i + 3], geometry[i + 4], geometry[i + 5]) - 1) < 1e-6, `${type} 的法線`);
    }
    sizes[type] = { length: max[2] - min[2], height: max[1] };
    const kinds = lights.map((light) => light.kind);
    for (const kind of ['port', 'starboard', 'stern']) assert.ok(kinds.includes(kind), `${type} 有 ${kind} 燈`);
  }
  assert.ok(sizes.container.length > 170 && sizes.container.length < 190, `貨櫃船長 ${sizes.container.length} m`);
  assert.ok(sizes.sailboat.height > 14 && sizes.sailboat.height < 18, `帆船桅杆高 ${sizes.sailboat.height} m`);
  assert.ok(sizes.fishing.length > 20 && sizes.fishing.length < 30, `漁船長 ${sizes.fishing.length} m`);
  assert.deepEqual(SHIP_ROUTES.map((r) => r.type).sort(), Object.keys(SHIP_MODELS).sort(), '每條航線都有對應的船');
});
