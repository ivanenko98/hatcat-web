// Profile section "Outage schedule": pick the queue of your house; the schedule comes from the operator every 30 minutes.
import { h } from '../dom.js';
import { t } from '../i18n.js';
import { clock } from '../fmt.js';
import { toast } from '../ui.js';
import { getOutages, saveQueue } from '../outages.js';

let busy = false;
// Row-major so the table reads 1.1 2.1 3.1 ... on the first row and 1.2 2.2 3.2 ... on the second.
const QUEUES = ['1.1', '2.1', '3.1', '4.1', '5.1', '6.1', '1.2', '2.2', '3.2', '4.2', '5.2', '6.2'];

const windowsOf = (day) => (day ? day.windows.filter((w) => w.kind === 'off').map((w) => `${w.from}–${w.to}`).join(', ') : '');

export function outagesSection(rerender) {
  const data = getOutages();
  const current = data ? data.queue : '5.1';
  const pick = async (q) => {
    if (busy || q === current) return;
    busy = true; rerender();
    try { await saveQueue(q); toast(t('outagesChosen', { q })); } catch (e) { toast(e.message === 'network' ? t('errNetwork') : e.message, 'error'); } finally { busy = false; rerender(); }
  };
  const today = data && data.days[0] && data.days.find((d) => d.date === new Intl.DateTimeFormat('en-CA', { timeZone: data.tz }).format(new Date()));
  const tomorrow = data && data.days.length > 1 ? data.days[data.days.length - 1] : null;

  return h('section', { class: 'psec' },
    h('h2', {}, t('outagesTitle')),
    h('p', { class: 'lead' }, t('outagesIntro')),
    h('div', { class: 'queue-grid', role: 'radiogroup', 'aria-label': t('outagesQueue') },
      QUEUES.map((q) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(q === current), class: 'queue-btn' + (q === current ? ' on' : ''), disabled: busy, onclick: () => pick(q) }, q))),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: 'https://www.poe.pl.ua/', target: '_blank', rel: 'noopener' }, t('outagesFind'))),
    data
      ? h('div', { class: 'pgroup' },
        h('div', { class: 'prow stack-row' }, h('div', { class: 'prow-title' }, t('outagesPreview', { q: current })),
          h('div', { class: 'prow-hint' }, [today && windowsOf(today) && `${t('outageToday')}: ${windowsOf(today)}`, tomorrow && tomorrow !== today && windowsOf(tomorrow) && `${t('outageTomorrow')}: ${windowsOf(tomorrow)}`].filter(Boolean).join(' · ') || t('outagesNoWindows'))))
      : h('p', { class: 'psec-note' }, t('outagesNoData')),
    h('p', { class: 'psec-note' }, data ? t('outagesSource', { t: data.updatedAt ? clock(data.updatedAt) : '–' }) : ''),
  );
}
