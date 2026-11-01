'use strict';
/* Shared helpers for all pages. Everything renders through h() / textContent, so user data is never parsed as HTML. */

async function api(path, { method = 'GET', body } = {}) {
  const hasBody = method !== 'GET';
  const res = await fetch(path, {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(body || {}) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** h('div.card#id', {onclick}, child, 'text', ...) */
function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = /^([a-z0-9]+)?(.*)$/i.exec(tag);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  // Second argument is attributes only if it's a plain object; anything else (including 0) is a child.
  if (attrs === null || attrs === undefined || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) {
    if (attrs !== null && attrs !== undefined) children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

function fmtMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents || 0) / 100);
}
function fmtTime(min) {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${ap}`;
}
function toHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
function fromHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function parseDate(d) { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day); }
function fmtDate(d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return parseDate(d).toLocaleDateString(undefined, opts);
}
function fmtDateLong(d) { return fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); }
function addDays(d, n) {
  const x = parseDate(d); x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function fmtDuration(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60); const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}
const STATUS_LABEL = { booked: 'Booked', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' };

let toastTimer;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = h('div.toast', { role: 'status' }); document.body.append(el); }
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

/** Read a form into a plain object. */
function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}
