// Profile section "Station limits": rating of the main breaker, warning thresholds and the inverter rating.
// Saved on the server so the site and Telegram agree. Save is only active when something changed and every value is valid.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { num } from '../fmt.js';
import { toast } from '../ui.js';
import { getLimits, saveLimits } from '../limits.js';

const NOMINAL_V = 220;
const DEFAULTS = { breakerA: 25, warnPct: 80, alarmPct: 95, inverterW: 4200 };
const RANGES = { breakerA: [6, 125], warnPct: [50, 99], alarmPct: [51, 100], inverterW: [500, 20000] };
const PRESETS = [[16, 'limitsPresetSocket'], [25], [32], [40], [50]];

export function limitsSection(rerender) {
  const saved = getLimits();
  const inputs = {};
  const errors = {};

  const field = (key, labelKey, unit, helpKey) => {
    const input = h('input', { type: 'number', inputmode: 'numeric', min: RANGES[key][0], max: RANGES[key][1], step: 1, value: saved[key], 'aria-label': t(labelKey) });
    inputs[key] = input;
    errors[key] = h('div', { class: 'field-err', role: 'alert' });
    return h('div', { class: 'prow stack-row' },
      h('label', { class: 'prow-title' }, t(labelKey)),
      helpKey && h('div', { class: 'prow-hint' }, t(helpKey)),
      h('div', { class: 'prow-control' }, h('div', { class: 'unit-input' }, input, h('span', { class: 'unit' }, unit)), errors[key]));
  };

  const preview = h('p', { class: 'preview' });
  const save = h('button', { type: 'button', class: 'btn primary' }, t('limitsSave'));
  const reset = h('button', { type: 'button', class: 'btn' }, t('limitsReset'));

  const read = () => Object.fromEntries(Object.keys(RANGES).map((k) => [k, Number(inputs[k].value)]));
  const update = () => {
    const v = read();
    let valid = true;
    for (const k of Object.keys(RANGES)) {
      const [lo, hi] = RANGES[k];
      let msg = '';
      if (!Number.isFinite(v[k]) || inputs[k].value === '' || v[k] < lo || v[k] > hi) msg = t('limitsRange', { lo: num(lo), hi: num(hi) });
      else if (k === 'alarmPct' && v.alarmPct <= v.warnPct) msg = t('limitsAlarmAbove');
      errors[k].textContent = msg;
      inputs[k].setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) valid = false;
    }
    const dirty = Object.keys(RANGES).some((k) => v[k] !== saved[k]);
    save.disabled = !valid || !dirty;
    reset.disabled = Object.keys(DEFAULTS).every((k) => v[k] === DEFAULTS[k]);
    preview.textContent = valid ? t('limitsApprox', { a: v.breakerA, kw: num((v.breakerA * NOMINAL_V) / 1000, 1), warn: num((v.breakerA * v.warnPct) / 100, 1), alarm: num((v.breakerA * v.alarmPct) / 100, 1) }) : '';
    chips.forEach(([btn, a]) => btn.classList.toggle('on', v.breakerA === a));
  };

  const chips = PRESETS.map(([a, labelKey]) => {
    const btn = h('button', { type: 'button', class: 'chip-btn', onclick: () => { inputs.breakerA.value = a; update(); } }, labelKey ? t(labelKey) : `${a} А`);
    return [btn, a];
  });

  save.addEventListener('click', async () => {
    save.disabled = true;
    try { await saveLimits(read()); toast(t('limitsSaved')); rerender(); } catch (e) { toast(e.message === 'network' ? t('errNetwork') : e.message, 'error'); update(); }
  });
  reset.addEventListener('click', () => { for (const k of Object.keys(DEFAULTS)) inputs[k].value = DEFAULTS[k]; update(); });

  const breakerRow = field('breakerA', 'limBreaker', 'А', 'limitBreakerHelp');
  const section = h('section', { class: 'psec' },
    h('h2', {}, t('limitsTitle')),
    h('p', { class: 'lead' }, t('limitsIntro')),
    h('div', { class: 'pgroup' },
      breakerRow,
      h('div', { class: 'prow stack-row' }, h('div', { class: 'chip-row', role: 'group', 'aria-label': t('limitsPresets') }, chips.map(([btn]) => btn))),
      field('warnPct', 'limWarn', '%', 'limitThresholdHelp'),
      field('alarmPct', 'limAlarm', '%'),
      field('inverterW', 'limInverter', 'ВА', 'limitInverterHelp')),
    preview,
    h('div', { class: 'btn-row' }, save, reset),
    h('p', { class: 'psec-note' }, t('limitsInverterNote', { w: saved.inverterW, warn: num((saved.inverterW * saved.warnPct) / 100), alarm: num((saved.inverterW * saved.alarmPct) / 100) })),
    h('p', { class: 'psec-note' }, t('limitsEstimate')),
  );
  for (const k of Object.keys(inputs)) inputs[k].addEventListener('input', update);
  update();
  return section;
}
