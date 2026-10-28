import { store } from './store.js';

// 'system' leaves data-theme unset so the prefers-color-scheme rules apply.
export function getTheme() { return store.get('theme') || 'system'; }

export function setTheme(v) {
  store.set('theme', v);
  applyTheme();
}

export function applyTheme() {
  const v = getTheme();
  if (v === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = v;
}
