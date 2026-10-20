// 把滑鼠、觸控與鍵盤操作轉成視角控制：拖曳旋轉、滾輪或雙指縮放、雙擊重設
// 鍵盤（畫面取得焦點時）：方向鍵轉動視線，+／- 縮放，0 重設

const KEY_TURN = Math.PI / 24; // 每按一次方向鍵轉 7.5°
const WHEEL_SENSITIVITY = 0.0015;

export function attachCameraInput(element, rig, { onInteract = () => {} } = {}) {
  const pointers = new Map();
  let pinchSpan = null;

  const currentSpan = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  element.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // 拖到畫面外也繼續追蹤；無法攔截時（例如指標已經放開）照常處理，不影響操作
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // 忽略
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinchSpan = pointers.size === 2 ? currentSpan() : null;
    element.classList.add('dragging');
    onInteract();
  });

  element.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    if (pointers.size === 1) {
      rig.rotate(point.x - previous.x, point.y - previous.y, element.clientHeight);
    } else if (pointers.size === 2) {
      // 雙指張開（距離變大）時拉近
      const span = currentSpan();
      if (pinchSpan && span > 0) rig.zoom(pinchSpan / span);
      pinchSpan = span;
    }
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    pinchSpan = pointers.size === 2 ? currentSpan() : null;
    if (pointers.size === 0) element.classList.remove('dragging');
  };
  element.addEventListener('pointerup', release);
  element.addEventListener('pointercancel', release);

  // 滾輪往下拉遠；觸控板的雙指縮放也會以 ctrlKey + wheel 送來，一併處理
  element.addEventListener('wheel', (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1;
    rig.zoom(Math.exp(event.deltaY * unit * WHEEL_SENSITIVITY));
    onInteract();
  }, { passive: false });

  element.addEventListener('dblclick', () => {
    rig.reset();
    onInteract();
  });

  element.addEventListener('keydown', (event) => {
    const actions = {
      ArrowLeft: () => rig.turn(-KEY_TURN, 0),
      ArrowRight: () => rig.turn(KEY_TURN, 0),
      ArrowUp: () => rig.turn(0, KEY_TURN),
      ArrowDown: () => rig.turn(0, -KEY_TURN),
      '+': () => rig.zoom(0.85),
      '=': () => rig.zoom(0.85),
      '-': () => rig.zoom(1 / 0.85),
      0: () => rig.reset(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
    onInteract();
  });
}
