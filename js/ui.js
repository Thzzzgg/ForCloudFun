// 參數控制面板：把滑桿、顏色、音效與畫質設定綁定到參數物件

const FORMATTERS = {
  windSpeed: (v) => `${v.toFixed(1)} m/s`,
  windDirection: (v) => `<span class="arrow" style="transform: rotate(${v}deg)">↑</span>${Math.round(v)}°`,
  heightScale: (v) => `${v.toFixed(2)}×`,
  choppiness: (v) => v.toFixed(2),
  foam: (v) => `${Math.round(v * 100)}%`,
  volume: (v) => `${Math.round(v * 100)}%`,
};

export function createControls(params, { onChange, onAudioToggle, onReset }) {
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  const audioButton = document.getElementById('audioToggle');
  const outputs = new Map([...document.querySelectorAll('output[data-for]')].map((o) => [o.dataset.for, o]));

  const setCollapsed = (collapsed) => {
    panel.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '展開' : '收合';
  };
  toggle.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));
  if (window.matchMedia('(max-width: 600px)').matches) setCollapsed(true);

  const showValue = (key) => {
    const output = outputs.get(key);
    if (output) output.innerHTML = FORMATTERS[key](params[key]);
  };

  for (const key of Object.keys(FORMATTERS)) {
    const input = document.getElementById(key);
    input.addEventListener('input', () => {
      params[key] = parseFloat(input.value);
      showValue(key);
      onChange(key);
    });
  }

  const color = document.getElementById('waterColor');
  color.addEventListener('input', () => {
    params.waterColor = color.value;
    onChange('waterColor');
  });

  const quality = document.getElementById('quality');
  quality.addEventListener('change', () => {
    params.quality = quality.value;
    onChange('quality');
  });

  const setAudioState = (on) => {
    audioButton.setAttribute('aria-pressed', String(on));
    audioButton.textContent = on ? '關閉海浪聲' : '開啟海浪聲';
  };
  audioButton.addEventListener('click', async () => {
    audioButton.disabled = true;
    try {
      setAudioState(await onAudioToggle());
    } catch (error) {
      console.warn('無法啟動音效：', error);
      setAudioState(false);
    } finally {
      audioButton.disabled = false;
    }
  });

  document.getElementById('reset').addEventListener('click', () => {
    onReset();
    sync();
  });

  // 把參數值同步回介面
  function sync() {
    for (const key of Object.keys(FORMATTERS)) {
      document.getElementById(key).value = params[key];
      showValue(key);
    }
    color.value = params.waterColor;
    quality.value = params.quality;
  }
  sync();

  const height = document.getElementById('stat-height');
  const period = document.getElementById('stat-period');
  const fps = document.getElementById('stat-fps');
  const performanceFields = new Map([...document.querySelectorAll('[data-perf]')].map((el) => [el.dataset.perf, el]));
  return {
    sync,
    disableAudio() {
      audioButton.disabled = true;
      audioButton.textContent = '此瀏覽器不支援音效';
    },
    setPerformance(info) {
      for (const [key, value] of Object.entries(info)) {
        const field = performanceFields.get(key);
        if (field) field.textContent = value;
      }
    },
    setStats({ significantHeight, peakPeriod, framesPerSecond }) {
      if (significantHeight !== undefined) height.textContent = `${significantHeight.toFixed(1)} m`;
      if (peakPeriod !== undefined) period.textContent = `${peakPeriod.toFixed(1)} s`;
      if (framesPerSecond !== undefined) fps.textContent = `${framesPerSecond.toFixed(framesPerSecond < 10 ? 1 : 0)} fps`;
    },
  };
}
