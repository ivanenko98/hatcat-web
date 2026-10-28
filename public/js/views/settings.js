import { h } from '../dom.js';
import { t, getLang } from '../i18n.js';
import { num } from '../fmt.js';
import { PROGRAMS, REG_SYNCED } from '../programs.js';
import { settingsFor, reg } from '../settings.js';
import { deviceHead } from './device-head.js';
import { errorText } from './login.js';

let rawOpen = false;

function valueText(p, regs) {
  const raw = reg(regs, p.reg);
  if (raw == null) return { text: '–', known: false };
  if (p.kind === 'toggle') return { text: t(raw ? 'on' : 'off'), known: true };
  if (p.kind === 'enum') {
    const key = `prog${p.n}o${raw}`;
    const text = t(key);
    return { text: text !== key ? text : p.fallback ? t(`prog${p.n}fb`) : String(raw), known: true };
  }
  const v = p.fn ? p.fn(raw) : raw;
  return { text: p.unit ? `${num(v)} ${p.unit}` : String(v), known: true };
}

function programRow(p, regs) {
  const { text, known } = valueText(p, regs);
  return h('li', { class: 'program' },
    h('span', { class: 'program-n' }, p.n),
    h('div', { class: 'program-main' },
      h('div', { class: 'program-title' }, t('prog' + p.n)),
      h('div', { class: 'program-desc' }, t('prog' + p.n + 'd')),
    ),
    h('div', { class: 'program-value' + (known ? '' : ' unknown'), title: known ? null : t('unknownValue') }, text),
  );
}

export function settingsView(root, { data, deviceId, rerender }) {
  const d = (data.json?.devices || []).find((x) => String(x.device_id) === String(deviceId));
  if (!d) { location.hash = '#/devices'; return; }
  const { regs, error, loading } = settingsFor(deviceId, rerender);
  const synced = reg(regs, REG_SYNCED);
  const hasExtraBattery = (data.json?.mas_battery?.length || 0) + (data.json?.mas_battery_new?.length || 0) > 0;

  const info = h('div', { class: 'card pad settings-info' },
    h('dl', { class: 'kv' },
      h('dt', {}, t('macAddress')), h('dd', { class: 'mono' }, d.mac_address || '–'),
      h('dt', {}, t('timezone')), h('dd', {}, d.deviceTimeZone || '–'),
      h('dt', {}, t('extraBattery')), h('dd', {}, hasExtraBattery ? t('batteryModule') : t('notConnected')),
      synced != null && [h('dt', {}, t('syncedAt')), h('dd', {}, new Date(synced * 1000).toLocaleString(getLang() === 'uk' ? 'uk-UA' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' }))],
    ),
  );

  let body;
  if (error && !regs) body = h('div', { class: 'card pad form-err' }, errorText(error));
  else if (loading || !regs) body = h('div', { class: 'loading' }, t('settingsLoading'));
  else {
    const raw = h('details', { class: 'card raw-block', ontoggle: (e) => { rawOpen = e.target.open; } },
      h('summary', {}, t('rawSettings')),
      h('table', { class: 'raw-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('register')), h('th', { class: 'num' }, t('value')))),
        h('tbody', {}, Object.entries(regs)
          .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
          .map(([k, v]) => h('tr', {}, h('td', { class: 'mono' }, k), h('td', { class: 'mono num' }, v)))),
      ),
    );
    raw.open = rawOpen;
    body = [
      h('p', { class: 'muted small' }, t('settingsNote')),
      h('section', { class: 'card programs' },
        h('h3', {}, t('stationSettings')),
        h('ul', {}, PROGRAMS.map((p) => programRow(p, regs))),
      ),
      raw,
    ];
  }
  root.replaceChildren(...deviceHead(d, 'settings'), info, ...[].concat(body));
}
