import { h } from '../dom.js';
import { t, LANGS, getLang, setLang } from '../i18n.js';
import { getSession, endSession } from '../api.js';
import { getTheme, setTheme } from '../theme.js';
import { store } from '../store.js';
import { telegramCard } from './telegram-card.js';
import { limitsCard } from './limits-card.js';

function segmented(name, options, current, onPick) {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    Object.entries(options).map(([value, label]) =>
      h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(value === current),
        class: value === current ? 'on' : '', onclick: () => onPick(value),
      }, label)),
  );
}

export function profileView(root, { rerender }) {
  const s = getSession();
  root.replaceChildren(
    h('h1', { class: 'page-title' }, t('profile')),
    h('div', { class: 'card pad stack' },
      h('div', { class: 'profile-email' }, s?.email || ''),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('language')),
        segmented(t('language'), LANGS, getLang(), (l) => { setLang(l); rerender(); })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('theme')),
        segmented(t('theme'), { system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') }, getTheme(),
          (v) => { setTheme(v); rerender(); })),
      notifyField(rerender),
      h('p', { class: 'muted small' }, t('readOnlyNote')),
      h('button', { class: 'btn danger', type: 'button', onclick: () => { if (confirm(t('logoutQuestion'))) endSession('logout'); } }, t('logout')),
    ),
    limitsCard(rerender),
    telegramCard(rerender),
  );
}

// Browser notifications need the user's permission, asked only when they switch the option on.
function notifyField(rerender) {
  const supported = typeof Notification !== 'undefined';
  const on = supported && store.get('notify') && Notification.permission === 'granted';
  const denied = supported && Notification.permission === 'denied';
  return h('div', { class: 'field' },
    h('span', { class: 'field-label' }, t('browserNotify')),
    h('p', { class: 'muted small' }, t('browserNotifyHint')),
    !supported ? h('p', { class: 'muted small' }, t('notifyUnsupported'))
      : denied ? h('p', { class: 'form-err' }, t('notifyDenied'))
        : h('button', {
          type: 'button', class: 'btn',
          onclick: async () => {
            if (on) store.set('notify', false);
            else if ((await Notification.requestPermission()) === 'granted') store.set('notify', true);
            rerender();
          },
        }, on ? t('turnOff') : t('allow')));
}
