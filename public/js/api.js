// Calls to the local proxy (/api/<endpoint>) and session handling.
// hatcat.eu always answers HTTP 200; the real status is the JSON "status" field.
import { store } from './store.js';

let session = store.get('session'); // {token, userId, email}
const listeners = new Set();

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function getSession() { return session; }
export function onSessionEnd(fn) { listeners.add(fn); }

// Token is base64("<user_id>:<expires_unix>:<hmac>").
export function tokenExpiry(token) {
  try {
    const exp = Number(atob(token).split(':')[1]);
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}

export function sessionValid() {
  if (!session?.token) return false;
  const exp = tokenExpiry(session.token);
  return exp == null || exp > Date.now();
}

export function endSession(reason) {
  if (session?.email) store.set('lastEmail', session.email);
  session = null;
  store.del('session');
  for (const fn of listeners) fn(reason);
}

async function call(endpoint, params = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') body.set(k, v);
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (session?.token) headers.authorization = 'Bearer ' + session.token;
  let r;
  try {
    r = await fetch('/api/' + endpoint, { method: 'POST', headers, body });
  } catch (e) {
    throw new ApiError('network', 0);
  }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) throw new ApiError(json?.message || json?.error || 'HTTP ' + r.status, r.status);
  if (!json) throw new ApiError('bad_response', 0);
  const st = Number(json.status);
  if (Number.isFinite(st) && st >= 400) throw new ApiError(json.message || 'error ' + st, st);
  return json;
}

async function authed(endpoint, params = {}) {
  if (!sessionValid()) { endSession('expired'); throw new ApiError('expired', 401); }
  try {
    return await call(endpoint, { user_id: session.userId, user_token: session.token, user_email: session.email, ...params });
  } catch (e) {
    if (e.status === 401) endSession('expired');
    throw e;
  }
}

export async function login(email, password) {
  const j = await call('m_login', { user_email: email, user_password: password });
  if (!j.user_token) throw new ApiError(j.message || 'no_token', 0);
  session = { token: String(j.user_token), userId: String(j.user_id ?? ''), email };
  store.set('session', session);
  store.set('lastEmail', email);
  return session;
}

export const getMyDevices = () => authed('m_get_my_device');
export const getDeviceSettings = (deviceId) => authed('m_get_device_settings', { device_id: deviceId });

// Local history recorded by server.js (not hatcat.eu).
export async function getHistory(path) {
  if (!sessionValid()) { endSession('expired'); throw new ApiError('expired', 401); }
  let r;
  try {
    r = await fetch('/history/' + path, { headers: { authorization: 'Bearer ' + session.token } });
  } catch { throw new ApiError('network', 0); }
  const json = await r.json().catch(() => null);
  if (!r.ok || !json) throw new ApiError(json?.error || 'HTTP ' + r.status, r.status);
  return json;
}

// Our own server's endpoints (/limits, /telegram/*), authorised with the session token.
export async function local(path, body) {
  if (!sessionValid()) { endSession('expired'); throw new ApiError('expired', 401); }
  let r;
  try {
    r = await fetch('/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + session.token, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError('network', 0); }
  const json = await r.json().catch(() => null);
  if (!r.ok || !json) throw new ApiError(json?.error || 'HTTP ' + r.status, r.status);
  return json;
}

// Telegram settings live on our server; the bot token goes there and is never read back.
export const telegram = (path, body) => local('telegram/' + path, body);
