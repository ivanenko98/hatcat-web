// Profile card: rating of the main breaker and the warning thresholds (kept on our server, used by the site and Telegram).
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { num } from '../fmt.js';
import { getLimits, saveLimits } from '../limits.js';

const NOMINAL_V = 220;
const st = { busy: false, info: '', error: '' };

export function limitsCard(rerender) {
  const lim = getLimits();
  const field = (label, value, min, max) => {
    const input = h('input', { type: 'number', inputmode: 'numeric', min, max, step: 1, value, disabled: st.busy });
    return [h('label', { class: 'limit-field' }, h('span', {}, label), input), input];
  };
  const [breakerLabel, breaker] = field(t('limitBreaker'), lim.breakerA, 6, 125);
  const [warnLabel, warn] = field(t('limitWarn'), lim.warnPct, 50, 99);
  const [alarmLabel, alarm] = field(t('limitAlarm'), lim.alarmPct, 51, 100);
  const [inverterLabel, inverter] = field(t('limitInverter'), lim.inverterW, 500, 20000);

  const save = async () => {
    st.busy = true; st.error = ''; st.info = ''; rerender();
    try {
      await saveLimits({ breakerA: Number(breaker.value), warnPct: Number(warn.value), alarmPct: Number(alarm.value), inverterW: Number(inverter.value) });
      st.info = t('limitsSaved');
    } catch (e) { st.error = e.message === 'network' ? t('errNetwork') : e.message; } finally { st.busy = false; rerender(); }
  };

  return h('section', { class: 'card pad stack' },
    h('h2', { class: 'tg-title' }, t('limitsTitle')),
    h('p', { class: 'muted small' }, t('limitsIntro')),
    h('div', { class: 'limit-grid' }, breakerLabel, warnLabel, alarmLabel, inverterLabel),
    h('p', { class: 'muted small' }, t('limitsApprox', {
      a: lim.breakerA, kw: num((lim.breakerA * NOMINAL_V) / 1000, 1),
      warn: num((lim.breakerA * lim.warnPct) / 100, 1), alarm: num((lim.breakerA * lim.alarmPct) / 100, 1),
    })),
    h('div', {}, h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: save }, t('limitsSave'))),
    st.error && h('p', { class: 'form-err', role: 'alert' }, st.error),
    st.info && h('p', { class: 'small', style: { color: 'var(--ok)' } }, st.info),
    h('p', { class: 'muted small' }, t('limitsInverterNote', { w: lim.inverterW, warn: num((lim.inverterW * lim.warnPct) / 100), alarm: num((lim.inverterW * lim.alarmPct) / 100) })),
    h('p', { class: 'muted small' }, t('limitsEstimate')),
  );
}
