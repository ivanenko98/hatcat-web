// Small shared controls: toast, on/off switch, segmented picker.
import { h } from './dom.js';

let toastBox = null;

// A short confirmation at the bottom of the screen; errors stay a little longer.
export function toast(text, kind = 'ok') {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const el = h('div', { class: 'toast ' + kind }, text);
  toastBox.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 5000 : 2400);
}

// <input type=checkbox role=switch> drawn as a switch; the input itself stays the focusable, clickable element.
export function switchEl({ checked, disabled, label, title, small, onchange }) {
  return h('label', { class: 'switch' + (small ? ' sm' : '') + (disabled ? ' disabled' : ''), title },
    h('input', { type: 'checkbox', role: 'switch', checked: !!checked, disabled: !!disabled, 'aria-label': label, onchange }),
    h('span', { class: 'track', 'aria-hidden': 'true' }));
}

export function segmented(name, options, current, onPick) {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    Object.entries(options).map(([value, label]) =>
      h('button', { type: 'button', role: 'radio', 'aria-checked': String(value === current), class: value === current ? 'on' : '', onclick: () => onPick(value) }, label)));
}
