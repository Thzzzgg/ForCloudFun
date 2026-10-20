// 蒲福風級與海況預設的單元測試
// 執行方式：node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beaufort, SEA_PRESETS } from '../js/beaufort.js';

test('風速換算成蒲福風級：各級的分界與名稱', () => {
  const cases = [
    [0, 0, '無風'], [0.29, 0, '無風'], [0.3, 1, '軟風'], [1.5, 1, '軟風'],
    [1.6, 2, '輕風'], [3.3, 2, '輕風'], [3.4, 3, '微風'], [5.4, 3, '微風'],
    [5.5, 4, '和風'], [7.9, 4, '和風'], [8, 5, '清風'], [10.7, 5, '清風'],
    [10.8, 6, '強風'], [13.8, 6, '強風'], [13.9, 7, '疾風'], [17.1, 7, '疾風'],
    [17.2, 8, '大風'], [20.7, 8, '大風'], [20.8, 9, '烈風'], [24.4, 9, '烈風'],
    [24.5, 10, '狂風'], [28.4, 10, '狂風'], [28.5, 11, '暴風'], [32.6, 11, '暴風'],
    [32.7, 12, '颶風'], [60, 12, '颶風'],
  ];
  for (const [speed, level, name] of cases) assert.deepEqual(beaufort(speed), { level, name }, `${speed} m/s`);
});

test('風速越大，風級越高', () => {
  let previous = 0;
  for (let speed = 0; speed <= 40; speed += 0.1) {
    const { level } = beaufort(speed);
    assert.ok(level >= previous && level <= 12, `${speed.toFixed(1)} m/s`);
    previous = level;
  }
});

test('海況預設由平靜到狂風，風、浪與天氣一個比一個強', () => {
  const order = ['calm', 'moderate', 'strong', 'gale'];
  assert.deepEqual(Object.keys(SEA_PRESETS), order);
  assert.deepEqual(order.map((key) => beaufort(SEA_PRESETS[key].windSpeed).name), ['輕風', '和風', '強風', '狂風']);
  for (let i = 1; i < order.length; i++) {
    const calmer = SEA_PRESETS[order[i - 1]];
    const rougher = SEA_PRESETS[order[i]];
    assert.ok(rougher.windSpeed > calmer.windSpeed, order[i]);
    assert.ok(rougher.swellHeight > calmer.swellHeight, order[i]);
    assert.ok(rougher.cloudCoverage > calmer.cloudCoverage, order[i]);
    assert.ok(rougher.visibility <= calmer.visibility, order[i]);
  }
});

test('海況預設的每個值都落在面板滑桿的範圍與刻度上', () => {
  // 從 index.html 讀出滑桿的範圍，預設值若不在刻度上，滑桿會停在別的位置
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sliders = new Map(
    [...html.matchAll(/<input type="range" id="(\w+)" min="([\d.]+)" max="([\d.]+)" step="([\d.]+)">/g)]
      .map(([, id, min, max, step]) => [id, { min: +min, max: +max, step: +step }]),
  );
  for (const [name, preset] of Object.entries(SEA_PRESETS)) {
    assert.ok(html.includes(`data-preset="${name}"`), `面板上有「${name}」的按鈕`);
    for (const [key, value] of Object.entries(preset)) {
      const slider = sliders.get(key);
      assert.ok(slider, `${key} 有對應的滑桿`);
      assert.ok(value >= slider.min && value <= slider.max, `${name}.${key} = ${value}`);
      const steps = (value - slider.min) / slider.step;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `${name}.${key} = ${value} 不在刻度上`);
    }
  }
});
