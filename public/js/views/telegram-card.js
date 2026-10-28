// Profile card for the Telegram integration. The token is typed here once, sent to our server and never shown again.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { telegram } from '../api.js';

const EVENTS = ['faults', 'warnings', 'cleared', 'grid', 'gridLoad', 'outputLoad', 'battery', 'offline', 'session'];
const st = { status: null, loading: false, error: '', info: '', code: null, busy: false };

function errText(e) {
  const code = String(e.message);
  const key = 'tgErr_' + code.split(':')[0].trim().replace(/\W+/g, '_');
  if (t(key) !== key) return t(key);
  return code === 'network' ? t('errNetwork') : code;
}

// Runs one server call with a busy flag, then redraws.
async function run(rerender, fn) {
  st.busy = true; st.error = ''; st.info = ''; rerender();
  try { await fn(); } catch (e) { st.error = errText(e); } finally { st.busy = false; rerender(); }
}

export function telegramCard(rerender) {
  if (!st.status && !st.loading) {
    st.loading = true;
    telegram('status').then((s) => { st.status = s; }, (e) => { st.error = errText(e); }).finally(() => { st.loading = false; rerender(); });
  }
  const s = st.status;
  const body = [];

  if (!s) {
    body.push(h('p', { class: 'muted' }, t('loading')));
  } else if (!s.configured) {
    const token = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: t('tgTokenPlaceholder'), disabled: st.busy });
    body.push(
      h('p', { class: 'muted small' }, t('tgStep1')),
      h('p', { class: 'muted small' }, t('tgStep2')),
      h('div', { class: 'tg-row' }, token,
        h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: () => run(rerender, async () => { st.status = await telegram('token', { token: token.value }); }) }, t('tgSaveToken'))),
    );
  } else if (!s.paired) {
    body.push(h('p', { class: 'small' }, t('tgBot', { name: s.botName })));
    if (st.code) {
      body.push(
        h('p', { class: 'muted small' }, t('tgPairHint', { bot: s.botName })),
        h('div', { class: 'tg-code mono' }, st.code),
        h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: () => run(rerender, async () => {
          let r;
          try { r = await telegram('discover', {}); } catch (e) { if (e.message === 'pairing_expired') st.code = null; throw e; }
          if (r.paired) { st.code = null; st.status = r; } else st.info = t('tgNotYet');
        }) }, t('tgCheck')),
      );
    } else {
      body.push(h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: () => run(rerender, async () => { st.code = (await telegram('pair', {})).code; }) }, t('tgStartPair')));
    }
  } else {
    const setConfig = (patch) => run(rerender, async () => { st.status = await telegram('config', patch); });
    body.push(
      h('p', { class: 'small' }, h('b', {}, t('tgPaired', { name: s.chatName })), ' · ', s.botName),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.enabled, disabled: st.busy, onchange: (e) => setConfig({ enabled: e.target.checked }) }), t('tgEnabled')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('tgEvents')),
        h('div', { class: 'tg-events' }, EVENTS.map((k) =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: s.events[k], disabled: st.busy || !s.enabled, onchange: (e) => setConfig({ events: { [k]: e.target.checked } }) }), t('tgEv_' + k))))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('tgMsgLang')),
        h('div', { class: 'segmented', role: 'radiogroup' }, [['uk', 'Українська'], ['en', 'English']].map(([code, label]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(s.lang === code), class: s.lang === code ? 'on' : '', disabled: st.busy, onclick: () => setConfig({ lang: code }) }, label)))),
      h('div', { class: 'tg-row' },
        h('button', { type: 'button', class: 'btn', disabled: st.busy || !s.enabled, onclick: () => run(rerender, async () => { await telegram('test', {}); st.info = t('tgTestSent'); }) }, t('tgTest')),
        h('button', { type: 'button', class: 'btn danger', disabled: st.busy, onclick: () => { if (confirm(t('tgDisconnectQ'))) run(rerender, async () => { st.status = await telegram('clear', {}); st.code = null; }); } }, t('tgDisconnect'))),
    );
  }
  if (s && !s.configured) st.code = null;

  return h('section', { class: 'card pad stack tg-card' },
    h('h2', { class: 'tg-title' }, t('tgTitle')),
    h('p', { class: 'muted small' }, t('tgIntro')),
    ...body,
    st.error && h('p', { class: 'form-err', role: 'alert' }, st.error),
    st.info && h('p', { class: 'small', style: { color: 'var(--ok)' } }, st.info),
    h('p', { class: 'muted small' }, t('tgNote')),
  );
}

