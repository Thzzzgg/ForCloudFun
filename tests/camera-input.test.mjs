// 滑鼠與觸控操作的單元測試：拖曳旋轉、雙擊重設，以及沒有拖曳的單擊才算點擊
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCameraInput } from '../js/camera-input.js';

// 只實作 js/camera-input.js 用到的部分的假畫布元素
class FakeElement extends EventTarget {
  clientHeight = 600;
  classList = { add() {}, remove() {} };
  setPointerCapture() {}
}

function setup() {
  const element = new FakeElement();
  const calls = { rotate: 0, zoom: 0, reset: 0, taps: [] };
  const rig = {
    rotate: () => calls.rotate++,
    zoom: () => calls.zoom++,
    reset: () => calls.reset++,
    turn: () => {},
  };
  attachCameraInput(element, rig, { onTap: (x, y) => calls.taps.push([x, y]) });
  const fire = (type, props = {}) => element.dispatchEvent(Object.assign(new Event(type), { pointerType: 'mouse', button: 0, ...props }));
  const press = (id, x, y) => fire('pointerdown', { pointerId: id, clientX: x, clientY: y });
  const move = (id, x, y) => fire('pointermove', { pointerId: id, clientX: x, clientY: y });
  const lift = (id, x, y) => fire('pointerup', { pointerId: id, clientX: x, clientY: y });
  const click = (x, y, detail = 1) => fire('click', { clientX: x, clientY: y, detail });
  return { calls, fire, press, move, lift, click };
}

test('沒有移動的單擊算一次點擊，傳回點擊的位置', () => {
  const { calls, press, lift, click } = setup();
  press(1, 200, 150);
  lift(1, 200, 150);
  click(200, 150);
  assert.deepEqual(calls.taps, [[200, 150]]);
});

test('手抖動幾個像素仍然算點擊，拖曳一段距離就只旋轉視角', () => {
  const { calls, press, move, lift, click } = setup();
  press(1, 100, 100);
  move(1, 103, 102);
  lift(1, 103, 102);
  click(103, 102);
  assert.equal(calls.taps.length, 1);

  press(1, 100, 100);
  move(1, 120, 100);
  move(1, 160, 110);
  lift(1, 160, 110);
  click(160, 110);
  assert.equal(calls.taps.length, 1, '拖曳後放開不算點擊');
  assert.ok(calls.rotate >= 2, '拖曳時旋轉視角');
});

test('雙擊只算一次點擊，並重設視角', () => {
  const { calls, fire, press, lift, click } = setup();
  for (const detail of [1, 2]) {
    press(1, 300, 200);
    lift(1, 300, 200);
    click(300, 200, detail);
  }
  fire('dblclick');
  assert.equal(calls.taps.length, 1);
  assert.equal(calls.reset, 1);
});

test('雙指縮放之後放開，不算點擊', () => {
  const { calls, press, move, lift, click } = setup();
  press(1, 100, 300);
  press(2, 200, 300);
  move(2, 220, 300);
  lift(2, 220, 300);
  lift(1, 100, 300);
  click(100, 300);
  assert.equal(calls.taps.length, 0);
  assert.equal(calls.zoom, 1);
});
