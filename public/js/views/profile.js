import { h, icon } from '../dom.js';
import { t, LANGS, getLang, setLang } from '../i18n.js';
import { getSession, endSession } from '../api.js';
import { getTheme, setTheme } from '../theme.js';
import { segmented } from '../ui.js';
import { webMasterOn } from '../notify-prefs.js';
import { getLimits } from '../limits.js';
import { getOutages } from '../outages.js';
import { telegramState, telegramSection } from './telegram-card.js';
import { notificationsSection } from './notifications-card.js';
import { limitsSection } from './limits-card.js';
import { outagesSection } from './outages-card.js';

const SECTIONS = [
  { id: 'general', icon: 'home', key: 'secGeneral' },
  { id: 'notifications', icon: 'pulse', key: 'secNotifications' },
  { id: 'telegram', icon: 'upload', key: 'secTelegram' },
  { id: 'outages', icon: 'grid_from', key: 'secOutages' },
  { id: 'limits', icon: 'socket', key: 'secLimits' },
];

function generalSection(rerender) {
  const s = getSession();
  return h('section', { class: 'psec' },
    h('h2', {}, t('secGeneral')),
    h('div', { class: 'pgroup' },
      h('div', { class: 'prow stack-row' }, h('div', { class: 'prow-hint' }, t('accountEmail')), h('div', { class: 'prow-email' }, s?.email || '')),
      h('div', { class: 'prow' }, h('div', { class: 'prow-title' }, t('language')),
        h('div', { class: 'prow-control' }, segmented(t('language'), LANGS, getLang(), (l) => { setLang(l); rerender(); }))),
      h('div', { class: 'prow' }, h('div', { class: 'prow-title' }, t('theme')),
        h('div', { class: 'prow-control' }, segmented(t('theme'), { system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') }, getTheme(), (v) => { setTheme(v); rerender(); })))),
    h('p', { class: 'psec-note' }, t('readOnlyNote')),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn danger', type: 'button', onclick: () => { if (confirm(t('logoutQuestion'))) endSession('logout'); } }, t('logout'))),
  );
}

// One line of live state under each section name in the rail.
function railStatus(id, rerender) {
  if (id === 'general') return getSession()?.email || '';
  if (id === 'notifications') return t(webMasterOn() ? 'statusOn' : 'statusOff');
  if (id === 'telegram') {
    const tg = telegramState(rerender);
    return !tg ? '…' : tg.paired ? t(tg.enabled ? 'statusOn' : 'statusPaused') : t(tg.configured ? 'tgStatusPair' : 'statusNotSet');
  }
  if (id === 'outages') { const o = getOutages(); return o ? t('outageQueue', { q: o.queue }) : '…'; }
  if (id === 'limits') { const l = getLimits(); return `${l.breakerA} А · ${l.inverterW} ВА`; }
  return '';
}

export function profileView(root, { rerender, section }) {
  const current = SECTIONS.some((x) => x.id === section) ? section : 'general';
  const nav = h('nav', { class: 'pnav', 'aria-label': t('profile') }, SECTIONS.map((x) =>
    h('a', { href: '#/profile/' + x.id, class: x.id === current ? 'on' : '', 'aria-current': x.id === current ? 'page' : null },
      icon(x.icon), h('span', { class: 'pnav-text' }, h('b', {}, t(x.key)), h('small', {}, railStatus(x.id, rerender))))));
  const content = { general: generalSection, notifications: notificationsSection, telegram: telegramSection, outages: outagesSection, limits: limitsSection }[current](rerender);
  root.replaceChildren(h('h1', { class: 'page-title' }, t('profile')), h('div', { class: 'profile-layout' }, nav, content));
}
