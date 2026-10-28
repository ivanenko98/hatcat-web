// Profile section "Notifications": every kind can be switched on or off, separately for the site and for Telegram.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { store } from '../store.js';
import { toast, switchEl } from '../ui.js';
import { EVENTS, webEnabled, webMasterOn, setWeb, setWebMaster } from '../notify-prefs.js';
import { telegramState, setTelegramConfig, telegramBusy } from './telegram-card.js';

// Event kinds grouped by what the person is thinking about when they look for them.
const GROUPS = [
  ['notifGroupStation', ['faults', 'warnings', 'cleared']],
  ['notifGroupPower', ['outage', 'grid', 'gridLoad']],
  ['notifGroupLoad', ['outputLoad', 'battery']],
  ['notifGroupSystem', ['offline', 'session']],
];
const byKey = Object.fromEntries(EVENTS.map((e) => [e.key, e]));

// Browser pop-ups need the user's permission, asked only when they switch the option on.
function browserRow(rerender) {
  const supported = typeof Notification !== 'undefined';
  const on = supported && store.get('notify') && Notification.permission === 'granted';
  const denied = supported && Notification.permission === 'denied';
  return h('div', { class: 'prow' },
    h('div', { class: 'prow-title' }, t('browserNotify')),
    h('div', { class: 'prow-hint' }, !supported ? t('notifyUnsupported') : denied ? t('notifyDenied') : t('browserNotifyHint')),
    h('div', { class: 'prow-control' }, switchEl({
      checked: on, disabled: !supported || denied, label: t('browserNotify'),
      onchange: async (e) => {
        if (!e.target.checked) store.set('notify', false);
        else if ((await Notification.requestPermission()) === 'granted') store.set('notify', true);
        rerender();
      },
    })));
}

export function notificationsSection(rerender) {
  const tg = telegramState(rerender);
  const tgReady = !!(tg && tg.paired);
  const tgOn = tgReady && tg.enabled;
  const busy = telegramBusy();
  const needTg = tgReady ? null : t('tgConnectFirst');

  const setAllWeb = (on) => { EVENTS.filter((e) => e.web).forEach((e) => setWeb(e.key, on)); rerender(); };
  const setAllTg = (on) => setTelegramConfig({ events: Object.fromEntries(EVENTS.filter((e) => e.tg).map((e) => [e.key, on])) }, rerender);

  const bulk = (onAll, onNone, disabled) => h('div', { class: 'matrix-bulk' },
    h('button', { type: 'button', class: 'link-btn', disabled, onclick: onAll }, t('bulkAll')), h('span', { class: 'muted' }, '·'),
    h('button', { type: 'button', class: 'link-btn', disabled, onclick: onNone }, t('bulkNone')));

  const rows = [];
  for (const [titleKey, keys] of GROUPS) {
    rows.push(h('div', { class: 'matrix-group' }, t(titleKey)));
    for (const key of keys) {
      const ev = byKey[key];
      rows.push(
        h('div', { class: 'matrix-label' }, t('ev_' + key)),
        ev.web
          ? h('div', { class: 'matrix-cell' }, switchEl({ small: true, checked: webEnabled(key), disabled: !webMasterOn(), label: `${t('ev_' + key)}: ${t('colWeb')}`, onchange: (e) => { setWeb(key, e.target.checked); rerender(); } }))
          : h('div', { class: 'matrix-cell' }, h('span', { class: 'muted', title: t('notifyNotAvailable') }, '–')),
        h('div', { class: 'matrix-cell' }, switchEl({ small: true, checked: !!(tg && tg.events[key]), disabled: !tgOn || busy, title: needTg, label: `${t('ev_' + key)}: Telegram`, onchange: (e) => setTelegramConfig({ events: { [key]: e.target.checked } }, rerender) })),
      );
    }
  }

  return h('section', { class: 'psec' },
    h('h2', {}, t('notifTitle')),
    h('p', { class: 'lead' }, t('notifIntro')),
    h('div', { class: 'pgroup' },
      h('div', { class: 'prow' },
        h('div', { class: 'prow-title' }, t('webMaster')), h('div', { class: 'prow-hint' }, t('webMasterHint')),
        h('div', { class: 'prow-control' }, switchEl({ checked: webMasterOn(), label: t('webMaster'), onchange: (e) => { setWebMaster(e.target.checked); rerender(); } }))),
      h('div', { class: 'prow' },
        h('div', { class: 'prow-title' }, t('tgMaster')),
        h('div', { class: 'prow-hint' }, tgReady ? t('tgMasterHint') : h('span', {}, t('tgConnectFirst') + ' ', h('a', { href: '#/profile/telegram' }, t('tgSetUp')))),
        h('div', { class: 'prow-control' }, switchEl({ checked: tgOn, disabled: !tgReady || busy, title: needTg, label: t('tgMaster'), onchange: (e) => setTelegramConfig({ enabled: e.target.checked }, rerender) }))),
      browserRow(rerender)),
    h('div', { class: 'matrix', role: 'group', 'aria-label': t('notifTitle') },
      h('div', { class: 'matrix-head' }),
      h('div', { class: 'matrix-head' }, t('colWeb'), bulk(() => setAllWeb(true), () => setAllWeb(false), !webMasterOn())),
      h('div', { class: 'matrix-head' }, 'Telegram', bulk(() => setAllTg(true), () => setAllTg(false), !tgOn || busy)),
      rows),
    h('p', { class: 'psec-note' }, t('notifStorageNote')),
  );
}
