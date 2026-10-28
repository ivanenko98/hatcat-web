// Profile section "Telegram": three steps (bot token, pair the chat, done). The token is typed once, sent to our server
// and never shown again. Which events are sent is chosen in the notifications section.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { telegram } from '../api.js';
import { toast, switchEl, segmented } from '../ui.js';

const st = { status: null, loading: false, error: '', code: null, busy: false };
let pollTimer = null;

function errText(e) {
  const code = String(e.message);
  const key = 'tgErr_' + code.split(':')[0].trim().replace(/\W+/g, '_');
  if (t(key) !== key) return t(key);
  return code === 'network' ? t('errNetwork') : code;
}

// One server call with a busy flag; failures show as a toast and under the controls.
async function run(rerender, fn) {
  st.busy = true; st.error = ''; rerender();
  try { await fn(); } catch (e) { st.error = errText(e); toast(st.error, 'error'); } finally { st.busy = false; rerender(); }
}

// Server-side Telegram settings, loaded once and shared with the notifications section and the rail.
export function telegramState(rerender) {
  if (!st.status && !st.loading) {
    st.loading = true;
    telegram('status').then((s) => { st.status = s; }, (e) => { st.error = errText(e); }).finally(() => { st.loading = false; rerender(); });
  }
  return st.status;
}
export const telegramBusy = () => st.busy;
export function setTelegramConfig(patch, rerender) {
  return run(rerender, async () => { st.status = await telegram('config', patch); toast(t('tgSaved')); });
}

// While a pairing code is on screen, look for it every few seconds so nobody has to press "Check".
function ensurePoll(rerender) {
  if (pollTimer || !st.code) return;
  pollTimer = setInterval(async () => {
    if (!st.code || !document.querySelector('.tg-code')) { clearInterval(pollTimer); pollTimer = null; return; }
    try {
      const r = await telegram('discover', {});
      if (r.paired) { st.code = null; st.status = r; clearInterval(pollTimer); pollTimer = null; toast(t('tgPairedToast')); rerender(); }
    } catch (e) {
      if (e.message === 'pairing_expired') { st.code = null; clearInterval(pollTimer); pollTimer = null; toast(t('tgErr_pairing_expired'), 'error'); rerender(); }
    }
  }, 3000);
}

const botUrl = (name) => 'https://t.me/' + String(name).replace(/^@/, '');
const external = (href, label) => h('a', { class: 'btn', href, target: '_blank', rel: 'noopener' }, label);

function stepper(step) {
  return h('ol', { class: 'steps' }, ['tgStepBot', 'tgStepChat', 'tgStepDone'].map((key, i) =>
    h('li', { class: i + 1 < step ? 'done' : i + 1 === step ? 'current' : '', 'aria-current': i + 1 === step ? 'step' : null },
      h('span', { class: 'step-n' }, i + 1 < step ? '✓' : String(i + 1)), t(key))));
}

export function telegramSection(rerender) {
  const s = telegramState(rerender);
  let step = 1;
  const body = [];

  if (!s) {
    body.push(h('p', { class: 'psec-note' }, t('loading')));
  } else if (!s.configured) {
    const token = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: t('tgTokenPlaceholder'), disabled: st.busy, 'aria-label': t('tgTokenLabel') });
    body.push(
      h('p', {}, t('tgStep1b')),
      h('div', { class: 'btn-row' }, external('https://t.me/BotFather', t('tgOpenBotFather'))),
      h('label', { class: 'field-stack' }, h('span', { class: 'field-label' }, t('tgTokenLabel')),
        h('div', { class: 'tg-row' }, token,
          h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: () => run(rerender, async () => { st.status = await telegram('token', { token: token.value }); toast(t('tgTokenSaved')); }) }, t('tgSaveToken')))),
    );
  } else if (!s.paired) {
    step = 2;
    body.push(h('p', {}, t('tgBot', { name: s.botName })));
    if (st.code) {
      ensurePoll(rerender);
      body.push(
        h('p', {}, t('tgPairHint2', { bot: s.botName })),
        h('div', { class: 'tg-codebox' },
          h('div', { class: 'tg-code mono', 'aria-live': 'polite' }, st.code),
          h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(st.code); toast(t('tgCopied')); } catch { /* clipboard may be blocked */ } } }, t('tgCopy'))),
        h('p', { class: 'psec-note waiting' }, h('i', { class: 'dot pulse' }), t('tgWaiting')),
        h('div', { class: 'btn-row' }, external(botUrl(s.botName), t('tgOpenBot', { name: s.botName }))),
      );
    } else {
      body.push(
        h('p', {}, t('tgPairIntro')),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn primary', disabled: st.busy, onclick: () => run(rerender, async () => { st.code = (await telegram('pair', {})).code; }) }, t('tgStartPair')),
          external(botUrl(s.botName), t('tgOpenBot', { name: s.botName }))),
      );
    }
  } else {
    step = 3;
    body.push(
      h('div', { class: 'prow' },
        h('div', { class: 'prow-title' }, h('i', { class: 'dot ' + (s.enabled ? 'ok' : '') }), ' ', t('tgPaired', { name: s.chatName })),
        h('div', { class: 'prow-hint' }, s.botName),
        h('div', { class: 'prow-control' }, switchEl({ checked: s.enabled, disabled: st.busy, label: t('tgMaster'), onchange: (e) => setTelegramConfig({ enabled: e.target.checked }, rerender) }))),
      h('div', { class: 'prow' },
        h('div', { class: 'prow-title' }, t('tgMsgLang')),
        h('div', { class: 'prow-control' }, segmented(t('tgMsgLang'), { uk: 'Українська', en: 'English' }, s.lang, (code) => { if (!st.busy) setTelegramConfig({ lang: code }, rerender); }))),
      h('p', { class: 'psec-note' }, h('a', { href: '#/profile/notifications' }, t('tgManageEvents'))),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', disabled: st.busy || !s.enabled, onclick: () => run(rerender, async () => { await telegram('test', {}); toast(t('tgTestSent')); }) }, t('tgTest')),
        h('button', { type: 'button', class: 'btn danger', disabled: st.busy, onclick: () => { if (confirm(t('tgDisconnectQ'))) run(rerender, async () => { st.status = await telegram('clear', {}); st.code = null; toast(t('tgDisconnected')); }); } }, t('tgDisconnect'))),
    );
  }
  if (s && !s.configured) st.code = null;

  return h('section', { class: 'psec' },
    h('h2', {}, t('tgTitle')),
    h('p', { class: 'lead' }, t('tgIntro')),
    s && stepper(step),
    h('div', { class: 'psec-body' }, ...body),
    st.error && h('p', { class: 'form-err', role: 'alert' }, st.error),
    h('p', { class: 'psec-note' }, t('tgNote')),
  );
}
