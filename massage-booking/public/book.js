'use strict';
const slug = decodeURIComponent(location.pathname.split('/')[2] || '');
const view = document.getElementById('view');
const errBox = document.getElementById('error');

const state = {
  info: null,          // { business, services, therapists, today }
  service: null,
  therapist: null,     // null = any
  date: null,
  dayStart: null,      // first date in the visible date strip
  slot: null,          // { startMin, therapistIds }
  step: 1,
};

function showError(msg) { errBox.textContent = msg; errBox.classList.toggle('hidden', !msg); }
function money(c) { return fmtMoney(c, state.info.business.currency); }
function therapistName(id) { return (state.info.therapists.find((t) => t.id === id) || {}).name || ''; }

function setStep(n) {
  state.step = n;
  document.querySelectorAll('#steps span').forEach((s, i) => s.classList.toggle('on', i < n));
  showError('');
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function backButton(to) {
  return h('button.btn-ghost.back', { type: 'button', onclick: () => setStep(to) }, '← Back');
}

function render() {
  view.replaceChildren();
  ({ 1: renderServices, 2: renderTherapists, 3: renderTimes, 4: renderDetails })[state.step]();
}

// ---------- step 1: service ----------
function renderServices() {
  const { services } = state.info;
  view.append(h('h2', 'Choose a service'));
  if (!services.length) {
    view.append(h('p.muted', 'Online booking isn’t available yet. Please contact us directly.'));
    return;
  }
  for (const s of services) {
    view.append(h('button.choice', {
      type: 'button',
      onclick: () => { state.service = s; state.therapist = null; setStep(2); },
    },
    h('div', h('strong', s.name), h('small', [fmtDuration(s.durationMin), s.description ? ` · ${s.description}` : ''])),
    h('span.price', money(s.priceCents))));
  }
}

// ---------- step 2: therapist ----------
function renderTherapists() {
  const options = state.info.therapists.filter((t) => t.serviceIds.includes(state.service.id));
  view.append(backButton(1), h('h2', 'Choose a therapist'));
  const pick = (t) => { state.therapist = t; state.date = null; state.dayStart = state.info.today; setStep(3); };
  if (options.length > 1) {
    view.append(h('button.choice', { type: 'button', onclick: () => pick(null) },
      h('div', h('strong', 'Any available therapist'), h('small', 'Most openings'))));
  }
  for (const t of options) {
    view.append(h('button.choice', { type: 'button', onclick: () => pick(t) },
      h('div', h('strong', t.name), t.bio ? h('small', t.bio) : null)));
  }
}

// ---------- step 3: date & time ----------
async function renderTimes() {
  const title = `${state.service.name}${state.therapist ? ` with ${state.therapist.name}` : ''}`;
  const daysEl = h('div.days', { role: 'group', 'aria-label': 'Dates' }, h('p.muted', 'Loading dates…'));
  const slotsEl = h('div');
  const maxStart = addDays(state.info.today, Math.max(0, state.info.business.bookingWindowDays - 13));
  const nav = h('div.row', { style: 'justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:nowrap' },
    h('button.btn-sm', { type: 'button', disabled: state.dayStart <= state.info.today, onclick: () => { state.dayStart = maxDate(state.info.today, addDays(state.dayStart, -14)); render(); }, 'aria-label': 'Earlier dates' }, '‹'),
    h('strong', { style: 'flex:0 1 auto;text-align:center' }, fmtDate(state.dayStart, { month: 'long', year: 'numeric' })),
    h('button.btn-sm', { type: 'button', disabled: state.dayStart >= maxStart, onclick: () => { state.dayStart = addDays(state.dayStart, 14); render(); }, 'aria-label': 'Later dates' }, '›'));
  view.append(backButton(2), h('h2', 'Pick a time'), h('p.muted', title), nav, daysEl, slotsEl);

  const q = new URLSearchParams({ serviceId: state.service.id, from: state.dayStart, count: 14 });
  if (state.therapist) q.set('therapistId', state.therapist.id);
  try {
    const { days } = await api(`/api/public/${encodeURIComponent(slug)}/days?${q}`);
    if (state.step !== 3) return;
    if (!state.date || !days.some((d) => d.date === state.date)) {
      state.date = (days.find((d) => d.available > 0) || days[0]).date;
    }
    daysEl.replaceChildren(...days.map((d) => h('button.day', {
      type: 'button', 'aria-pressed': String(d.date === state.date), disabled: !d.available,
      onclick: () => { state.date = d.date; daysEl.querySelectorAll('.day').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.date === d.date))); loadSlots(slotsEl); },
      'data-date': d.date,
    }, h('span.dow', fmtDate(d.date, { weekday: 'short' })), h('b', parseDate(d.date).getDate()), h('span.avail', d.available ? `${d.available} open` : 'Full'))));
    daysEl.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
    loadSlots(slotsEl);
  } catch (e) { showError(e.message); }
}

function maxDate(a, b) { return a > b ? a : b; }

async function loadSlots(el) {
  el.replaceChildren(h('p.muted', { style: 'margin-top:16px' }, 'Loading times…'));
  const q = new URLSearchParams({ serviceId: state.service.id, date: state.date });
  if (state.therapist) q.set('therapistId', state.therapist.id);
  try {
    const { slots, date } = await api(`/api/public/${encodeURIComponent(slug)}/slots?${q}`);
    if (date !== state.date) return;
    if (!slots.length) { el.replaceChildren(h('p.muted', { style: 'margin-top:16px' }, 'No openings on this day.')); return; }
    const groups = [['Morning', (m) => m < 720], ['Afternoon', (m) => m >= 720 && m < 1020], ['Evening', (m) => m >= 1020]];
    el.replaceChildren(h('h3', { style: 'margin-top:20px' }, fmtDateLong(state.date)));
    for (const [label, test] of groups) {
      const list = slots.filter((s) => test(s.startMin));
      if (!list.length) continue;
      el.append(h('p.small.muted', { style: 'margin:14px 0 0' }, label), h('div.slots', list.map((s) => h('button.slot', {
        type: 'button', onclick: () => { state.slot = s; setStep(4); },
      }, fmtTime(s.startMin)))));
    }
  } catch (e) { el.replaceChildren(); showError(e.message); }
}

// ---------- step 4: details ----------
function renderDetails() {
  const s = state.service;
  const who = state.therapist ? state.therapist.name : 'First available therapist';
  const form = h('form', { novalidate: false },
    h('div.field', h('label', { for: 'name' }, 'Full name'), h('input#name', { name: 'name', required: true, autocomplete: 'name' })),
    h('div.row',
      h('div.field', h('label', { for: 'email' }, 'Email'), h('input#email', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
      h('div.field', h('label', { for: 'phone' }, 'Phone'), h('input#phone', { name: 'phone', type: 'tel', required: true, autocomplete: 'tel' }))),
    h('div.field', h('label', { for: 'notes' }, 'Anything we should know? ', h('span.muted', '(optional)')),
      h('textarea#notes', { name: 'notes', placeholder: 'Injuries, areas to focus on, pressure preference…' })),
    h('button.btn-primary.btn-block', { type: 'submit' }, 'Confirm booking'),
    state.info.business.cancelCutoffHours
      ? h('p.small.muted', { style: 'margin-top:10px;text-align:center' }, `Free cancellation up to ${state.info.business.cancelCutoffHours} hours before your appointment.`)
      : null);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Booking…'; showError('');
    try {
      const res = await api(`/api/public/${encodeURIComponent(slug)}/book`, {
        method: 'POST',
        body: { ...formData(form), serviceId: s.id, therapistId: state.therapist?.id || null, date: state.date, startMin: state.slot.startMin },
      });
      renderDone(res);
    } catch (err) {
      showError(err.message);
      btn.disabled = false; btn.textContent = 'Confirm booking';
      if (err.status === 409) { state.slot = null; setTimeout(() => setStep(3), 1800); }
    }
  });

  view.append(backButton(3), h('h2', 'Your details'),
    h('div.summary',
      h('div', h('strong', s.name), h('span', money(s.priceCents))),
      h('div.muted', h('span', fmtDateLong(state.date)), h('span', `${fmtTime(state.slot.startMin)} – ${fmtTime(state.slot.startMin + s.durationMin)}`)),
      h('div.muted', h('span', who))),
    form);
}

function renderDone({ appointment: a, manageToken }) {
  document.querySelectorAll('#steps span').forEach((s) => s.classList.add('on'));
  const manageUrl = `${location.origin}/b/${encodeURIComponent(slug)}/manage?ref=${encodeURIComponent(a.ref)}&token=${encodeURIComponent(manageToken)}`;
  const b = state.info.business;
  view.replaceChildren(h('div.card',
    h('div.done-icon', { 'aria-hidden': 'true' }, '✓'),
    h('h2', 'You’re booked!'),
    h('p', `${a.serviceName} with ${a.therapistName}`),
    h('p', h('strong', fmtDateLong(a.date)), h('br'), `${fmtTime(a.startMin)} – ${fmtTime(a.endMin)}`),
    h('p.muted.small', 'Booking reference'), h('p.ref', a.ref),
    b.address ? h('p.small', b.address) : null,
    h('p.small.muted', 'Save this link to view or cancel your booking:'),
    h('div.row', { style: 'flex-wrap:nowrap' },
      h('input', { value: manageUrl, readonly: true, onfocus: (e) => e.target.select(), 'aria-label': 'Manage booking link' }),
      h('button', { type: 'button', style: 'flex:none', onclick: () => navigator.clipboard?.writeText(manageUrl).then(() => toast('Link copied')) }, 'Copy')),
    h('p', { style: 'margin-top:16px' }, h('a', { href: manageUrl }, 'Manage booking'), ' · ', h('a', { href: location.pathname }, 'Book another'))));
}

// ---------- boot ----------
(async function init() {
  try {
    state.info = await api(`/api/public/${encodeURIComponent(slug)}`);
    const b = state.info.business;
    document.title = `Book — ${b.name}`;
    document.getElementById('biz').append(h('h1', b.name), h('p.muted.small', [b.address, b.phone].filter(Boolean).join(' · ')));
    setStep(1);
  } catch (e) {
    showError(e.status === 404 ? 'We couldn’t find this booking page.' : e.message);
  }
}());
