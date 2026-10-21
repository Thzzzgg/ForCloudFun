// 海浪環境音效：以 Web Audio 即時合成，不需要任何音檔
// 底噪（遠方海浪的低頻隆隆聲）＋ 浪潮起伏 ＋ 依浪週期隨機觸發的碎浪聲 ＋ 隨風速增強的風聲 ＋ 浮標的鐘聲 ＋ 點擊水面的落水聲

const NOISE_SECONDS = 6;

// 浮標的鐘：主音（Hz）與泛音 [相對主音的倍率, 相對音量, 衰減時間（秒）]
// 鐘的泛音不是整數倍（例如小三度的 1.2 倍），聽起來才像鐘
const BELL_PITCH = 380;
const BELL_PARTIALS = [
  [0.5, 0.6, 7], [1, 0.55, 5], [1.2, 0.5, 4.5], [1.5, 0.2, 3], [2, 0.65, 3.5],
  [2.5, 0.25, 2], [2.67, 0.2, 1.6], [3, 0.15, 1.2], [4, 0.1, 0.8],
];

function createNoiseBuffer(ctx, color) {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const fade = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const raw = new Float32Array(length + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let brown = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'pink') {
        // Paul Kellet 的粉紅噪音濾波
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (color === 'brown') {
        brown = (brown + 0.02 * white) / 1.02;
        raw[i] = brown * 3.5;
      } else {
        raw[i] = white;
      }
    }
    // 頭尾交叉淡化，讓循環播放時沒有接縫
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      if (i < fade) {
        const t = i / fade;
        data[i] = raw[i] * t + raw[length + i] * (1 - t);
      } else {
        data[i] = raw[i];
      }
    }
  }
  return buffer;
}

export class OceanAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.6;
    this.intensity = 0.6;
    this.period = 6;
    this.wind = 0; // 風聲強度（0～1）
    this.howl = 0; // 暴風的呼嘯聲（0～1）
    this.timer = null;
  }

  get supported() {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  build() {
    const Context = window.AudioContext || window.webkitAudioContext;
    const ctx = new Context();
    this.ctx = ctx;
    this.buffers = {
      white: createNoiseBuffer(ctx, 'white'),
      pink: createNoiseBuffer(ctx, 'pink'),
      brown: createNoiseBuffer(ctx, 'brown'),
    };

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(compressor);

    // 底噪：棕噪音經低通濾波
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 320;
    this.rumbleGain = ctx.createGain();
    this.loop(this.buffers.brown).connect(rumbleFilter).connect(this.rumbleGain).connect(this.master);

    // 浪潮：粉紅噪音，音量與亮度隨每道浪起伏
    this.swellFilter = ctx.createBiquadFilter();
    this.swellFilter.type = 'lowpass';
    this.swellFilter.frequency.value = 500;
    this.swellGain = ctx.createGain();
    this.swellGain.gain.value = 0.1;
    this.loop(this.buffers.pink).connect(this.swellFilter).connect(this.swellGain).connect(this.master);

    // 風聲：粉紅噪音經帶通濾波，音量與音色隨陣風起伏；暴風時再加上一層窄頻的呼嘯聲
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.loop(this.buffers.pink).connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.howlFilter = ctx.createBiquadFilter();
    this.howlFilter.type = 'bandpass';
    this.howlFilter.frequency.value = 800;
    this.howlFilter.Q.value = 10;
    this.howlGain = ctx.createGain();
    this.howlGain.gain.value = 0;
    this.loop(this.buffers.white).connect(this.howlFilter).connect(this.howlGain).connect(this.master);

    this.applyLevels(0);
    this.nextWave = ctx.currentTime + 0.3;
    this.nextGust = ctx.currentTime;
  }

  loop(buffer) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start(0, Math.random() * NOISE_SECONDS);
    return source;
  }

  async setEnabled(on) {
    if (on) {
      if (!this.ctx) this.build();
      await this.ctx.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.4);
      this.nextWave = Math.max(this.nextWave, this.ctx.currentTime + 0.2);
      this.nextGust = Math.max(this.nextGust, this.ctx.currentTime);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.schedule(), 200);
    } else if (this.ctx) {
      this.enabled = false;
      clearInterval(this.timer);
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      const ctx = this.ctx;
      setTimeout(() => { if (!this.enabled) ctx.suspend(); }, 1500);
    }
    return this.enabled;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
  }

  // 依有效波高與尖峰週期調整音效強度與節奏
  setSeaState(significantHeight, peakPeriod) {
    this.intensity = Math.min(Math.max(significantHeight / 3, 0.05), 1.4);
    this.period = Math.min(Math.max(peakPeriod, 2.5), 12);
    if (this.ctx) this.applyLevels(0.5);
  }

  // 依風速調整風聲：微風時幾乎聽不到，蒲福 7 級（約 14 m/s）以上開始出現呼嘯聲
  setWind(windSpeed) {
    this.wind = Math.min(Math.max((windSpeed - 5) / 20, 0), 1) ** 1.5;
    this.howl = Math.min(Math.max((windSpeed - 14) / 11, 0), 1);
  }

  applyLevels(smoothing) {
    const now = this.ctx.currentTime;
    this.rumbleGain.gain.setTargetAtTime(0.12 + 0.3 * this.intensity, now, smoothing || 0.01);
  }

  // 提前排程即將到來的浪（背景分頁的計時器會被降頻，所以多排一些）
  schedule() {
    const lookAhead = this.ctx.currentTime + 1.5;
    while (this.nextWave < lookAhead) {
      this.scheduleWave(this.nextWave);
      this.nextWave += this.period * (0.7 + Math.random() * 0.6);
    }
    while (this.nextGust < lookAhead) {
      this.scheduleGust(this.nextGust);
      this.nextGust += 0.8 + Math.random() * 2.2;
    }
  }

  // 陣風：每隔一兩秒換一個隨機的強度，風聲的音量與音高平滑地跟著變化
  scheduleGust(time) {
    const gust = 0.55 + 0.45 * Math.random();
    const smoothing = 0.4 + Math.random() * 0.6;
    this.windGain.gain.setTargetAtTime(0.35 * this.wind * gust, time, smoothing);
    this.windFilter.frequency.setTargetAtTime(300 + 500 * this.wind * gust, time, smoothing);
    this.howlGain.gain.setTargetAtTime(0.5 * this.howl * gust * gust, time, smoothing);
    this.howlFilter.frequency.setTargetAtTime(600 + 500 * gust + 300 * this.howl, time, smoothing * 1.5);
  }

  scheduleWave(time) {
    const intensity = this.intensity;
    const rise = this.period * 0.45;
    const fall = this.period * 0.55;
    const peakGain = 0.08 + 0.32 * intensity * (0.7 + Math.random() * 0.6);
    const gain = this.swellGain.gain;
    gain.setTargetAtTime(peakGain, time, rise / 3);
    gain.setTargetAtTime(0.05 + 0.05 * intensity, time + rise, fall / 3);
    const frequency = this.swellFilter.frequency;
    frequency.setTargetAtTime(600 + 1400 * intensity, time, rise / 3);
    frequency.setTargetAtTime(350 + 200 * intensity, time + rise, fall / 3);

    // 風浪越大，越常出現碎浪
    if (Math.random() < 0.3 + 0.55 * Math.min(intensity, 1)) {
      this.scheduleBreak(time + rise * (0.6 + Math.random() * 0.4), intensity);
    }
  }

  // 鐘聲：strength 為敲擊力道（0～1），越用力高音越多、餘音越長；
  // pan 為聲音的左右位置（-1～1），distance 為與鏡頭的距離（公尺），越遠越小聲、高音被空氣吸收得越多
  ringBell(strength, { pan = 0, distance = 30 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const { ctx } = this;
    const time = ctx.currentTime + 0.02;
    const output = ctx.createGain();
    output.gain.value = (0.6 * (0.25 + 0.75 * strength)) / (1 + distance / 20);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 9000 / (1 + distance / 80);
    output.connect(air);
    let last = air;
    if (ctx.createStereoPanner) {
      last = ctx.createStereoPanner();
      last.pan.value = pan;
      air.connect(last);
    }
    last.connect(this.master);

    let longest = null;
    let longestEnd = 0;
    for (const [ratio, amplitude, decay] of BELL_PARTIALS) {
      const level = amplitude * (ratio > 2 ? 0.3 + 0.7 * strength : 1) * 0.5;
      const end = time + decay * (0.6 + 0.4 * strength);
      // 每個泛音由兩個略微走音的正弦波組成，產生鐘聲特有的嗡嗡起伏
      for (const detune of [-0.7, 0.7]) {
        const oscillator = ctx.createOscillator();
        oscillator.frequency.value = BELL_PITCH * ratio + detune * Math.sqrt(ratio);
        const envelope = ctx.createGain();
        envelope.gain.setValueAtTime(0.0001, time);
        envelope.gain.exponentialRampToValueAtTime(level, time + 0.004);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(envelope).connect(output);
        oscillator.start(time);
        oscillator.stop(end + 0.05);
        if (end > longestEnd) {
          longest = oscillator;
          longestEnd = end;
        }
      }
    }

    // 鐘錘撞上鐘的「叮」：很短的高頻噪音
    const click = ctx.createBufferSource();
    click.buffer = this.buffers.white;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 4200;
    band.Q.value = 1.5;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.0001, time);
    clickGain.gain.exponentialRampToValueAtTime(0.05 + 0.25 * strength, time + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    click.connect(band).connect(clickGain).connect(output);
    click.start(time, Math.random() * (NOISE_SECONDS - 0.1));
    click.stop(time + 0.05);

    // 最長的泛音結束後拆掉整串節點
    longest.onended = () => last.disconnect();
  }

  // 落水聲：石頭入水的「噗通」（水中氣泡共振、音高往上滑的短音）＋ 水花的嘩啦聲 ＋ 水滴落回水面的滴答聲
  // strength 為水花的大小（約 0.5～1.5），pan 與 distance 同鐘聲
  splash(strength, { pan = 0, distance = 30 } = {}) {
    if (!this.ctx || !this.enabled) return;
    const { ctx } = this;
    const time = ctx.currentTime + 0.02;
    const output = ctx.createGain();
    output.gain.value = (0.9 * Math.min(strength, 1.5)) / (1 + distance / 15);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = 12000 / (1 + distance / 60);
    output.connect(air);
    let last = air;
    if (ctx.createStereoPanner) {
      last = ctx.createStereoPanner();
      last.pan.value = pan;
      air.connect(last);
    }
    last.connect(this.master);

    // 噗通：入水時被拖進水裡的氣泡收縮，發出往上滑的短音
    const plop = ctx.createOscillator();
    plop.frequency.setValueAtTime(260 / Math.sqrt(strength), time);
    plop.frequency.exponentialRampToValueAtTime(900 / Math.sqrt(strength), time + 0.09);
    const plopGain = ctx.createGain();
    plopGain.gain.setValueAtTime(0.0001, time);
    plopGain.gain.exponentialRampToValueAtTime(0.5, time + 0.005);
    plopGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    plop.connect(plopGain).connect(output);
    plop.start(time);
    plop.stop(time + 0.2);

    // 嘩啦：寬頻的水花聲，很快衰減
    const end = time + 0.6;
    const wash = ctx.createBufferSource();
    wash.buffer = this.buffers.white;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1600;
    band.Q.value = 0.6;
    const washGain = ctx.createGain();
    washGain.gain.setValueAtTime(0.0001, time);
    washGain.gain.exponentialRampToValueAtTime(0.35, time + 0.01);
    washGain.gain.exponentialRampToValueAtTime(0.0001, end);
    wash.connect(band).connect(washGain).connect(output);
    wash.start(time, Math.random() * (NOISE_SECONDS - 0.7));
    wash.stop(end + 0.05);

    // 滴答：水花落回水面的一顆顆水滴，每顆是很短、音高往上滑的小水泡聲
    let lastDrop = plop;
    let lastEnd = time + 0.2;
    for (let i = 0; i < 9; i++) {
      const at = time + 0.25 + Math.random() * 0.7;
      const drop = ctx.createOscillator();
      const pitch = 1400 + Math.random() * 1800;
      drop.frequency.setValueAtTime(pitch, at);
      drop.frequency.exponentialRampToValueAtTime(pitch * 1.6, at + 0.025);
      const dropGain = ctx.createGain();
      dropGain.gain.setValueAtTime(0.0001, at);
      dropGain.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.05, at + 0.003);
      dropGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      drop.connect(dropGain).connect(output);
      drop.start(at);
      drop.stop(at + 0.05);
      if (at + 0.05 > lastEnd) {
        lastDrop = drop;
        lastEnd = at + 0.05;
      }
    }
    // 水花聲與水滴聲都結束後拆掉整串節點
    (lastEnd > end ? lastDrop : wash).onended = () => last.disconnect();
  }

  // 碎浪：帶通噪音由高頻往低頻掃，加上泡沫的嘶嘶聲
  scheduleBreak(time, intensity) {
    const { ctx } = this;
    const duration = 1.8 + Math.random() * 2.2;
    const attack = 0.15 + Math.random() * 0.35;
    const level = (0.25 + 0.55 * Math.min(intensity, 1.2)) * (0.6 + Math.random() * 0.5);

    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const output = panner || this.master;
    if (panner) {
      panner.pan.value = Math.random() * 1.4 - 0.7;
      panner.connect(this.master);
    }

    const crash = ctx.createBufferSource();
    crash.buffer = this.buffers.pink;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.7;
    band.frequency.setValueAtTime(1800 + 1200 * Math.random(), time);
    band.frequency.exponentialRampToValueAtTime(500, time + duration);
    const crashGain = ctx.createGain();
    crashGain.gain.setValueAtTime(0.0001, time);
    crashGain.gain.exponentialRampToValueAtTime(level, time + attack);
    crashGain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    crash.connect(band).connect(crashGain).connect(output);
    crash.start(time, Math.random() * (NOISE_SECONDS - duration - 0.1));
    crash.stop(time + duration + 0.05);

    const hiss = ctx.createBufferSource();
    hiss.buffer = this.buffers.white;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 4000;
    const hissGain = ctx.createGain();
    const hissEnd = time + duration * 1.3;
    hissGain.gain.setValueAtTime(0.0001, time);
    hissGain.gain.exponentialRampToValueAtTime(level * 0.12, time + attack * 1.5);
    hissGain.gain.exponentialRampToValueAtTime(0.0001, hissEnd);
    hiss.connect(high).connect(hissGain).connect(output);
    hiss.start(time, Math.random() * (NOISE_SECONDS - duration * 1.3 - 0.1));
    hiss.stop(hissEnd + 0.05);

    if (panner) hiss.onended = () => panner.disconnect();
  }
}
