// 參數控制面板：把滑桿、顏色、音效與畫質設定綁定到參數物件
import { formatTime, periodName } from './celestial.js';
import { beaufort, SEA_PRESETS } from './beaufort.js';

const direction = (v) => `<span class="arrow" style="transform: rotate(${v}deg)">↑</span>${Math.round(v)}°`;

const FORMATTERS = {
  time: (v) => `${formatTime(v)} ${periodName(v)}`,
  cloudCoverage: (v) => (v > 0 ? `${Math.round(v * 100)}%` : '無'),
  visibility: (v) => `${Math.round(v)} km`,
  windSpeed: (v) => {
    const { level, name } = beaufort(v);
    return `${v.toFixed(1)} m/s · ${level} 級${name}`;
  },
  windDirection: direction,
  heightScale: (v) => `${v.toFixed(2)}×`,
  choppiness: (v) => v.toFixed(2),
  swellHeight: (v) => (v > 0 ? `${v.toFixed(1)} m` : '無'),
  swellDirection: direction,
  swellPeriod: (v) => `${v.toFixed(1)} s`,
  foam: (v) => `${Math.round(v * 100)}%`,
  volume: (v) => `${Math.round(v * 100)}%`,
};

export function createControls(params, { onChange, onAudioToggle, onReset, onResetView }) {
  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  const audioButton = document.getElementById('audioToggle');
  const timelapseButton = document.getElementById('timelapse');
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

  // 縮時播放：時間自動前進，手動拖動時間滑桿時停止
  const showTimelapse = () => {
    timelapseButton.setAttribute('aria-pressed', String(params.timelapse));
    timelapseButton.textContent = params.timelapse ? '停止縮時播放' : '縮時播放';
  };
  const setTimelapse = (on) => {
    params.timelapse = on;
    showTimelapse();
    onChange('timelapse');
  };
  timelapseButton.addEventListener('click', () => setTimelapse(!params.timelapse));

  // 海況預設：一次設定風速、湧浪與天氣；目前的參數剛好和某個預設相同時，那個按鈕顯示為按下
  const presetButtons = [...document.querySelectorAll('[data-preset]')];
  const showPresets = () => {
    for (const button of presetButtons) {
      const preset = SEA_PRESETS[button.dataset.preset];
      const active = Object.entries(preset).every(([key, value]) => params[key] === value);
      button.setAttribute('aria-pressed', String(active));
    }
  };
  for (const button of presetButtons) {
    button.addEventListener('click', () => {
      for (const [key, value] of Object.entries(SEA_PRESETS[button.dataset.preset])) {
        params[key] = value;
        refresh(key);
        onChange(key);
      }
      showPresets();
    });
  }

  for (const key of Object.keys(FORMATTERS)) {
    const input = document.getElementById(key);
    input.addEventListener('input', () => {
      params[key] = parseFloat(input.value);
      showValue(key);
      onChange(key);
      showPresets();
      if (key === 'time' && params.timelapse) setTimelapse(false);
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

  // 視角模式：兩個按鈕組成的單選群組，左右方向鍵也能切換
  const viewButtons = [...document.querySelectorAll('[data-view]')];
  const showViewMode = () => {
    for (const button of viewButtons) {
      const selected = button.dataset.view === params.viewMode;
      button.setAttribute('aria-checked', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  };
  const selectView = (button) => {
    params.viewMode = button.dataset.view;
    showViewMode();
    onChange('viewMode');
  };
  viewButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectView(button));
    button.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = viewButtons[(index + step + viewButtons.length) % viewButtons.length];
      next.focus();
      selectView(next);
    });
  });
  document.getElementById('resetView').addEventListener('click', () => onResetView());

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

  // 程式改變參數後（例如縮時播放推進時間）更新對應的滑桿與數值
  function refresh(key) {
    document.getElementById(key).value = params[key];
    showValue(key);
  }

  // 把參數值同步回介面
  function sync() {
    for (const key of Object.keys(FORMATTERS)) refresh(key);
    color.value = params.waterColor;
    quality.value = params.quality;
    showViewMode();
    showTimelapse();
    showPresets();
  }
  sync();

  const height = document.getElementById('stat-height');
  const period = document.getElementById('stat-period');
  const fps = document.getElementById('stat-fps');
  const performanceFields = new Map([...document.querySelectorAll('[data-perf]')].map((el) => [el.dataset.perf, el]));
  return {
    sync,
    refresh,
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
