import { h } from '../dom.js';
import { t } from '../i18n.js';
import { login, ApiError } from '../api.js';
import { store } from '../store.js';

export function errorText(e) {
  if (e instanceof ApiError && e.message === 'network') return t('errNetwork');
  if (e instanceof ApiError && e.message === 'bad_response') return t('errBadResponse');
  return e.message || String(e);
}

export function loginView(root, { notice, onDone }) {
  const err = h('div', { class: 'form-err', role: 'alert' }, notice || '');
  const email = h('input', { name: 'email', type: 'email', autocomplete: 'username', required: true, value: store.get('lastEmail') || '' });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const show = h('input', { type: 'checkbox', onchange: () => { pass.type = show.checked ? 'text' : 'password'; } });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, t('signIn'));

  const form = h('form', {
    class: 'login-form',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      err.textContent = '';
      try {
        await login(email.value.trim(), pass.value);
        onDone();
      } catch (ex) {
        err.textContent = errorText(ex);
      } finally {
        btn.disabled = false;
      }
    },
  },
    h('label', {}, t('email'), email),
    h('label', {}, t('password'), pass),
    h('label', { class: 'check' }, show, t('showPassword')),
    err,
    btn,
  );

  root.replaceChildren(
    h('div', { class: 'login' },
      h('div', { class: 'login-card card' },
        h('img', { class: 'login-cat', src: 'assets/svg/logo_hatcat_cat.svg', alt: '' }),
        h('h1', {}, t('loginTitle')),
        h('p', { class: 'muted' }, t('loginSubtitle')),
        form,
      ),
    ),
  );
  (email.value ? pass : email).focus();
}
