'use strict';
const page = document.getElementById('page');
const modal = document.getElementById('modal');
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ctx = { business: null, services: [], therapists: [], scheduleDate: null };
const money = (c) => fmtMoney(c, ctx.business.currency);

// ---------- modal helper ----------
function openModal(title, body, actions = []) {
  const err = h('div.error.hidden', { role: 'alert' });
  modal.replaceChildren(
    h('div.modal-body', h('h2', title), err, body),
    h('div.modal-actions', ...actions, h('button', { type: 'button', onclick: () => modal.close() }, 'Close')),
  );
  modal.showModal();
  return {
    error(msg) { err.textContent = msg; err.classList.toggle('hidden', !msg); modal.querySelector('.modal-body').scrollTop = 0; },
    close() { modal.close(); },
  };
}
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

/** Run an async action from a button, showing errors in the modal (or a toast). */
async function act(btn, m, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { if (m) m.error(e.message); else toast(e.message); } finally { btn.disabled = false; }
}

async function refreshLookups() {
  const [s, t] = await Promise.all([api('/api/services'), api('/api/therapists')]);
  ctx.services = s.services; ctx.therapists = t.therapists;
}

// ---------- routing ----------
const pages = { schedule: renderSchedule, appointments: renderAppointments, therapists: renderTherapists, services: renderServices, clients: renderClients, settings: renderSettings };
function go(name) {
  if (!pages[name]) name = 'schedule';
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  document.querySelectorAll('#nav button').forEach((b) => { if (b.dataset.page === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  page.replaceChildren(h('p.muted', 'Loading…'));
  pages[name]().catch((e) => page.replaceChildren(h('div.error', e.message)));
}
document.getElementById('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-page]'); if (b) go(b.dataset.page); });
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
document.getElementById('logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/#login'; });

function setupChecklist() {
  const steps = [];
  if (!ctx.services.length) steps.push(['Add your services', 'services']);
  if (!ctx.therapists.length) steps.push(['Add your therapists and their hours', 'therapists']);
  else if (!ctx.therapists.some((t) => t.serviceIds.length && t.hours.length)) steps.push(['Give a therapist working hours and services', 'therapists']);
  if (!steps.length) return null;
  return h('div.notice', h('strong', 'Finish setting up to start taking bookings: '),
    steps.map(([label, p], i) => [i ? ' · ' : '', h('a', { href: `#${p}` }, label)]));
}

// ======================= SCHEDULE =======================
async function renderSchedule() {
  await refreshLookups();
  const [stats, day] = await Promise.all([api('/api/stats'), api(`/api/schedule?date=${ctx.scheduleDate || ''}`)]);
  ctx.scheduleDate = day.date;

  const dateInput = h('input', { type: 'date', value: day.date, onchange: (e) => { if (e.target.value) { ctx.scheduleDate = e.target.value; renderSchedule(); } }, 'aria-label': 'Date' });
  const shift = (n) => { ctx.scheduleDate = addDays(ctx.scheduleDate, n); renderSchedule(); };

  page.replaceChildren(
    setupChecklist() || '',
    h('div.stats',
      stat(stats.todayCount, 'Appointments today'),
      stat(stats.next7Count, 'Booked next 7 days'),
      stat(money(stats.next7RevenueCents), 'Expected next 7 days'),
      stat(money(stats.last30RevenueCents), 'Completed last 30 days')),
    h('div.page-head',
      h('div.daynav',
        h('button.btn-sm', { onclick: () => shift(-1), 'aria-label': 'Previous day' }, '‹'),
        h('h2', { style: 'margin:0' }, day.date === day.today ? `Today, ${fmtDate(day.date, { month: 'short', day: 'numeric' })}` : fmtDate(day.date)),
        h('button.btn-sm', { onclick: () => shift(1), 'aria-label': 'Next day' }, '›'),
        day.date !== day.today ? h('button.btn-sm', { onclick: () => { ctx.scheduleDate = day.today; renderSchedule(); } }, 'Today') : null,
        dateInput),
      h('button.btn-primary', { onclick: () => newBookingModal({ date: day.date }) }, '+ New booking')),
    dayGrid(day));
}

function stat(v, label) { return h('div.card.stat', h('div.v', v), h('div.l', label)); }

function dayGrid(day) {
  if (!day.therapists.length) return h('div.card', h('p.muted', 'No active therapists yet. '), h('a', { href: '#therapists' }, 'Add a therapist'));
  const PX = 1.1; // pixels per minute
  // Show from the earliest opening/appointment to the latest, padded to whole hours.
  let lo = 9 * 60; let hi = 18 * 60;
  for (const t of day.therapists) for (const x of t.hours) { lo = Math.min(lo, x.startMin); hi = Math.max(hi, x.endMin); }
  for (const a of day.appointments) { lo = Math.min(lo, a.startMin); hi = Math.max(hi, a.endMin); }
  lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
  const height = (hi - lo) * PX;
  const y = (m) => (m - lo) * PX;

  const grid = h('div.grid', { style: `grid-template-columns: 56px repeat(${day.therapists.length}, minmax(150px, 1fr))` });
  grid.append(h('div.grid-head', ''), ...day.therapists.map((t) => h('div.grid-head', t.name)));

  const gutter = h('div.gutter', { style: `height:${height}px` });
  for (let m = lo; m <= hi; m += 60) if (m > lo) gutter.append(h('span', { style: `top:${y(m)}px` }, fmtTime(m).replace(':00', '')));
  grid.append(gutter);

  for (const t of day.therapists) {
    const col = h('div.col', { style: `height:${height}px` });
    for (let m = lo + 60; m < hi; m += 60) col.append(h('div.hourline', { style: `top:${y(m)}px` }));
    // shade closed time
    let cursor = lo;
    for (const w of [...t.hours].sort((a, b) => a.startMin - b.startMin)) {
      if (w.startMin > cursor) col.append(h('div.closed', { style: `top:${y(cursor)}px;height:${(w.startMin - cursor) * PX}px` }));
      cursor = Math.max(cursor, w.endMin);
    }
    if (cursor < hi) col.append(h('div.closed', { style: `top:${y(cursor)}px;height:${(hi - cursor) * PX}px` }));
    for (const o of t.timeOff) {
      const s = Math.max(o.startMin, lo); const e = Math.min(o.endMin, hi);
      if (e > s) col.append(h('div.off', { style: `top:${y(s)}px;height:${(e - s) * PX}px` }, `Time off${o.reason ? `: ${o.reason}` : ''}`));
    }
    for (const a of day.appointments.filter((x) => x.therapistId === t.id)) {
      col.append(h('button.appt', {
        class: a.status, type: 'button', style: `top:${y(a.startMin)}px;height:${Math.max(22, (a.endMin - a.startMin) * PX - 2)}px`,
        onclick: () => appointmentModal(a), title: `${a.clientName} — ${a.serviceName}`,
      }, h('b', a.clientName), h('span', `${fmtTime(a.startMin)} · ${a.serviceName}`)));
    }
    if (day.date === day.today) {
      const now = new Date(); const nm = now.getHours() * 60 + now.getMinutes();
      if (nm > lo && nm < hi) col.append(h('div.now-line', { style: `top:${y(nm)}px` }));
    }
    grid.append(col);
  }
  return h('div.grid-wrap', grid);
}

// ---------- appointment detail ----------
function appointmentModal(a, onChange = () => go(location.hash.slice(1))) {
  const notes = h('textarea', { value: a.internalNotes || '', placeholder: 'Private notes (only staff see these)' });
  const setStatus = (status) => async (e) => {
    await act(e.currentTarget, m, async () => {
      if (status === 'cancelled' && !confirm('Cancel this appointment?')) return;
      await api(`/api/appointments/${a.id}`, { method: 'PATCH', body: { status, internalNotes: notes.value } });
      m.close(); toast('Appointment updated'); onChange();
    });
  };
  const actions = [];
  if (a.status === 'booked') {
    actions.push(h('button.btn-danger', { onclick: setStatus('cancelled') }, 'Cancel'),
      h('button', { onclick: setStatus('no_show') }, 'No-show'),
      h('button.btn-primary', { onclick: setStatus('completed') }, 'Mark completed'));
  } else {
    actions.push(h('button', { onclick: setStatus('booked') }, a.status === 'cancelled' ? 'Restore booking' : 'Back to booked'));
  }
  actions.unshift(h('button', { onclick: setStatus(a.status) }, 'Save notes'));
  const m = openModal(a.serviceName, h('div',
    h('p', h('span.badge', { class: a.status }, STATUS_LABEL[a.status]), ' ', h('span.small.muted', `Ref ${a.ref} · ${a.source === 'online' ? 'Booked online' : 'Added by staff'}`)),
    h('p', h('strong', fmtDateLong(a.date)), h('br'), `${fmtTime(a.startMin)} – ${fmtTime(a.endMin)} with ${a.therapistName}`, h('br'), money(a.priceCents)),
    h('h3.section-title', 'Client'),
    h('p', h('strong', a.clientName), h('br'), h('a', { href: `mailto:${a.clientEmail}` }, a.clientEmail), a.clientPhone ? [h('br'), h('a', { href: `tel:${a.clientPhone}` }, a.clientPhone)] : null),
    h('p', h('a', { href: '#clients', onclick: () => { modal.close(); setTimeout(() => clientModal(a.clientId), 50); } }, 'View client history')),
    a.clientNotes ? [h('h3.section-title', 'Client’s note'), h('p.notice', a.clientNotes)] : null,
    h('h3.section-title', 'Staff notes'), notes), actions);
}

// ---------- new booking (staff) ----------
function newBookingModal({ date, client = {} } = {}) {
  const activeServices = ctx.services.filter((s) => s.active);
  const activeTherapists = ctx.therapists.filter((t) => t.active);
  if (!activeServices.length || !activeTherapists.length) { toast('Add a service and a therapist first'); return; }
  const svc = h('select', { name: 'serviceId', required: true }, activeServices.map((s) => h('option', { value: s.id }, `${s.name} (${fmtDuration(s.durationMin)})`)));
  const th = h('select', { name: 'therapistId', required: true });
  const fillTherapists = () => {
    const sid = Number(svc.value);
    const list = activeTherapists.filter((t) => t.serviceIds.includes(sid));
    th.replaceChildren(...(list.length ? list : activeTherapists).map((t) => h('option', { value: t.id }, t.name)));
    loadSlots();
  };
  const dateIn = h('input', { type: 'date', name: 'date', value: date, required: true });
  const timeIn = h('input', { type: 'time', name: 'time', required: true, step: 300 });
  const suggestions = h('div.row', { style: 'gap:6px;margin-top:6px' });
  async function loadSlots() {
    suggestions.replaceChildren();
    if (!dateIn.value || !svc.value || !th.value) return;
    try {
      const q = new URLSearchParams({ serviceId: svc.value, therapistId: th.value, date: dateIn.value });
      const { slots } = await api(`/api/public/${encodeURIComponent(ctx.business.slug)}/slots?${q}`);
      if (!slots.length) { suggestions.append(h('span.small.muted', 'No open slots in working hours — you can still enter a custom time.')); return; }
      suggestions.append(...slots.slice(0, 24).map((s) => h('button.btn-sm', { type: 'button', style: 'flex:0 0 auto', onclick: () => { timeIn.value = toHHMM(s.startMin); } }, fmtTime(s.startMin))));
    } catch { /* suggestions are optional */ }
  }
  svc.addEventListener('change', fillTherapists); th.addEventListener('change', loadSlots); dateIn.addEventListener('change', loadSlots);

  const form = h('form',
    h('div.field', h('label', 'Service'), svc),
    h('div.field', h('label', 'Therapist'), th),
    h('div.row', h('div.field', h('label', 'Date'), dateIn), h('div.field', h('label', 'Start time'), timeIn)),
    h('div.field', h('span.small.muted', 'Open slots:'), suggestions),
    h('h3.section-title', 'Client'),
    h('div.field', h('label', 'Name'), h('input', { name: 'name', required: true, value: client.name })),
    h('div.row',
      h('div.field', h('label', 'Email'), h('input', { name: 'email', type: 'email', required: true, value: client.email })),
      h('div.field', h('label', 'Phone'), h('input', { name: 'phone', type: 'tel', value: client.phone }))),
    h('div.field', h('label', 'Notes'), h('textarea', { name: 'notes' })));
  const save = h('button.btn-primary', { type: 'button' }, 'Create booking');
  const m = openModal('New booking', form, [save]);
  save.addEventListener('click', () => {
    if (!form.reportValidity()) return;
    act(save, m, async () => {
      const body = formData(form);
      const payload = { ...body, serviceId: Number(body.serviceId), therapistId: Number(body.therapistId) };
      try {
        await api('/api/appointments', { method: 'POST', body: payload });
      } catch (e) {
        // Soft rule (outside hours, time off, limits): let staff knowingly book anyway.
        if (e.status === 409 && e.data?.canOverride && confirm(`${e.message}.\n\nBook anyway?`)) {
          await api('/api/appointments', { method: 'POST', body: { ...payload, override: true } });
        } else throw e;
      }
      m.close(); toast('Booking created'); ctx.scheduleDate = body.date; go(location.hash.slice(1) || 'schedule');
    });
  });
  fillTherapists();
}

// ======================= APPOINTMENTS LIST =======================
async function renderAppointments() {
  await refreshLookups();
  const today = (await api('/api/stats')).today;
  const filters = { status: 'booked', therapistId: '', from: today, to: addDays(today, 30) };
  const listEl = h('div.card');
  const statusSel = h('select', { onchange: (e) => { filters.status = e.target.value; load(); } },
    h('option', { value: 'booked' }, 'Booked'), h('option', { value: '' }, 'All statuses'),
    h('option', { value: 'completed' }, 'Completed'), h('option', { value: 'cancelled' }, 'Cancelled'), h('option', { value: 'no_show' }, 'No-show'));
  const thSel = h('select', { onchange: (e) => { filters.therapistId = e.target.value; load(); } },
    h('option', { value: '' }, 'All therapists'), ctx.therapists.map((t) => h('option', { value: t.id }, t.name)));
  const fromIn = h('input', { type: 'date', value: filters.from, onchange: (e) => { filters.from = e.target.value; load(); } });
  const toIn = h('input', { type: 'date', value: filters.to, onchange: (e) => { filters.to = e.target.value; load(); } });

  async function load() {
    listEl.replaceChildren(h('p.muted', 'Loading…'));
    const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    const { appointments } = await api(`/api/appointments?${q}`);
    if (!appointments.length) { listEl.replaceChildren(h('p.muted', 'No appointments match.')); return; }
    listEl.replaceChildren();
    let last = '';
    for (const a of appointments) {
      if (a.date !== last) { listEl.append(h('div.date-group', fmtDateLong(a.date))); last = a.date; }
      listEl.append(h('div.list-item',
        h('div.grow', h('strong', `${fmtTime(a.startMin)} · ${a.clientName}`), h('div.small.muted', `${a.serviceName} with ${a.therapistName} · ${money(a.priceCents)}`)),
        h('span.badge', { class: a.status }, STATUS_LABEL[a.status]),
        h('button.btn-sm', { onclick: () => appointmentModal(a, load) }, 'Open')));
    }
  }
  page.replaceChildren(
    h('div.page-head', h('h1', 'Appointments'), h('button.btn-primary', { onclick: () => newBookingModal({ date: today }) }, '+ New booking')),
    h('div.row', { style: 'margin-bottom:12px' }, statusSel, thSel, fromIn, toIn),
    listEl);
  await load();
}

// ======================= THERAPISTS =======================
async function renderTherapists() {
  await refreshLookups();
  const list = h('div.card');
  if (!ctx.therapists.length) list.append(h('p.muted', 'No therapists yet. Add your team so clients can book them.'));
  for (const t of ctx.therapists) {
    const days = [...new Set(t.hours.map((x) => x.weekday))].map((d) => WEEKDAYS[d].slice(0, 3)).join(', ');
    list.append(h('div.list-item',
      h('div.grow', h('strong', t.name), !t.active ? [' ', h('span.badge', 'Inactive')] : null,
        h('div.small.muted', [`${t.serviceIds.length} service${t.serviceIds.length === 1 ? '' : 's'}`, days ? `Works ${days}` : 'No hours set'].join(' · '))),
      h('button.btn-sm', { onclick: () => timeOffModal(t) }, 'Time off'),
      h('button.btn-sm', { onclick: () => therapistModal(t) }, 'Edit')));
  }
  page.replaceChildren(h('div.page-head', h('h1', 'Therapists'), h('button.btn-primary', { onclick: () => therapistModal() }, '+ Add therapist')), list);
}

function therapistModal(t = null) {
  const isNew = !t;
  t = t || { name: '', bio: '', active: true, serviceIds: ctx.services.filter((s) => s.active).map((s) => s.id), hours: [1, 2, 3, 4, 5].map((d) => ({ weekday: d, startMin: 540, endMin: 1020 })) };
  const name = h('input', { value: t.name, required: true });
  const bio = h('textarea', { value: t.bio, placeholder: 'Shown to clients on the booking page' });
  const active = h('input', { type: 'checkbox', checked: t.active });
  const svcChecks = ctx.services.map((s) => ({ s, el: h('input', { type: 'checkbox', checked: t.serviceIds.includes(s.id) }) }));
  // One working block per day in the UI. (The API supports split shifts.)
  const rows = WEEKDAYS.map((label, d) => {
    const block = t.hours.find((x) => x.weekday === d);
    const on = h('input', { type: 'checkbox', checked: !!block });
    const start = h('input', { type: 'time', value: toHHMM(block ? block.startMin : 540), disabled: !block, step: 900 });
    const end = h('input', { type: 'time', value: toHHMM(block ? block.endMin : 1020), disabled: !block, step: 900 });
    on.addEventListener('change', () => { start.disabled = end.disabled = !on.checked; });
    return { d, on, start, end, el: h('div.hours-row', h('label.check', on, label.slice(0, 3)), start, end) };
  });
  const body = h('div',
    h('div.field', h('label', 'Name'), name),
    h('div.field', h('label', 'Bio'), bio),
    h('label.check', active, 'Accepting bookings'),
    h('h3.section-title', 'Services offered'),
    ctx.services.length ? h('div.svc-checks', svcChecks.map(({ s, el }) => h('label.check', el, s.name))) : h('p.small.muted', 'Add services first, then assign them here.'),
    h('h3.section-title', 'Weekly hours'),
    rows.map((r) => r.el));
  const save = h('button.btn-primary', { type: 'button' }, isNew ? 'Add therapist' : 'Save');
  const actions = [save];
  if (!isNew) {
    actions.unshift(h('button.btn-danger', { type: 'button', onclick: (e) => act(e.currentTarget, m, async () => {
      if (!confirm(`Remove ${t.name}? Therapists with past bookings are archived instead.`)) return;
      await api(`/api/therapists/${t.id}`, { method: 'DELETE' }); m.close(); toast('Therapist removed'); renderTherapists();
    }) }, 'Remove'));
  }
  const m = openModal(isNew ? 'Add therapist' : `Edit ${t.name}`, body, actions);
  save.addEventListener('click', () => act(save, m, async () => {
    if (!name.value.trim()) throw new Error('Name is required');
    const hours = rows.filter((r) => r.on.checked).map((r) => ({ weekday: r.d, startMin: fromHHMM(r.start.value), endMin: fromHHMM(r.end.value) }));
    for (const x of hours) {
      if (x.startMin === null || x.endMin === null || x.endMin <= x.startMin) throw new Error(`Check the hours for ${WEEKDAYS[x.weekday]}`);
    }
    const payload = { name: name.value, bio: bio.value, active: active.checked, serviceIds: svcChecks.filter((x) => x.el.checked).map((x) => x.s.id), hours };
    await api(isNew ? '/api/therapists' : `/api/therapists/${t.id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
    m.close(); toast(isNew ? 'Therapist added' : 'Saved'); renderTherapists();
  }));
}

async function timeOffModal(t) {
  const listEl = h('div');
  const today = (await api('/api/stats')).today;
  const from = h('input', { type: 'date', value: today, required: true });
  const to = h('input', { type: 'date', value: today });
  const allDay = h('input', { type: 'checkbox', checked: true });
  const st = h('input', { type: 'time', value: '12:00', disabled: true });
  const en = h('input', { type: 'time', value: '14:00', disabled: true });
  allDay.addEventListener('change', () => { st.disabled = en.disabled = allDay.checked; });
  const reason = h('input', { placeholder: 'e.g. Vacation, training' });
  async function load() {
    const { timeOff } = await api(`/api/therapists/${t.id}/time-off`);
    listEl.replaceChildren(timeOff.length ? h('div', timeOff.map((o) => h('div.list-item',
      h('div.grow', h('strong', fmtDate(o.date)), h('span.small.muted', ` ${o.startMin === 0 && o.endMin === 1440 ? 'All day' : `${fmtTime(o.startMin)} – ${fmtTime(o.endMin)}`}${o.reason ? ` · ${o.reason}` : ''}`)),
      h('button.btn-sm.btn-danger', { onclick: async () => { await api(`/api/time-off/${o.id}`, { method: 'DELETE' }); load(); } }, 'Remove'))))
      : h('p.small.muted', 'No upcoming time off.'));
  }
  const add = h('button.btn-primary', { type: 'button' }, 'Add time off');
  const m = openModal(`Time off — ${t.name}`, h('div',
    h('div.row', h('div.field', h('label', 'From'), from), h('div.field', h('label', 'To'), to)),
    h('label.check', { style: 'margin-bottom:10px' }, allDay, 'All day'),
    h('div.row', h('div.field', h('label', 'Start'), st), h('div.field', h('label', 'End'), en)),
    h('div.field', h('label', 'Reason'), reason),
    h('p.small.muted', 'Existing bookings aren’t cancelled automatically — check the schedule.'),
    h('h3.section-title', 'Upcoming'), listEl), [add]);
  add.addEventListener('click', () => act(add, m, async () => {
    const body = { date: from.value, endDate: to.value || from.value, reason: reason.value };
    if (!allDay.checked) { body.startMin = fromHHMM(st.value); body.endMin = fromHHMM(en.value); }
    await api(`/api/therapists/${t.id}/time-off`, { method: 'POST', body });
    m.error(''); reason.value = ''; toast('Time off added'); load();
  }));
  load();
}

// ======================= SERVICES =======================
async function renderServices() {
  await refreshLookups();
  const list = h('div.card');
  if (!ctx.services.length) list.append(h('p.muted', 'No services yet. Add what you offer — e.g. “Swedish Massage, 60 min”.'));
  for (const s of ctx.services) {
    list.append(h('div.list-item',
      h('div.grow', h('strong', s.name), !s.active ? [' ', h('span.badge', 'Hidden')] : null,
        h('div.small.muted', `${fmtDuration(s.durationMin)} · ${money(s.priceCents)}${s.bufferMin ? ` · ${s.bufferMin} min buffer` : ''}`)),
      h('button.btn-sm', { onclick: () => serviceModal(s) }, 'Edit')));
  }
  page.replaceChildren(h('div.page-head', h('h1', 'Services'), h('button.btn-primary', { onclick: () => serviceModal() }, '+ Add service')), list);
}

function serviceModal(s = null) {
  const isNew = !s;
  s = s || { name: '', description: '', durationMin: 60, priceCents: 0, bufferMin: 15, active: true };
  const form = h('form',
    h('div.field', h('label', 'Name'), h('input', { name: 'name', value: s.name, required: true, placeholder: 'Swedish Massage – 60 min' })),
    h('div.field', h('label', 'Description'), h('textarea', { name: 'description', value: s.description })),
    h('div.row',
      h('div.field', h('label', 'Duration (min)'), h('input', { name: 'durationMin', type: 'number', min: 5, max: 600, step: 5, value: s.durationMin, required: true })),
      h('div.field', h('label', `Price (${ctx.business.currency})`), h('input', { name: 'price', type: 'number', min: 0, step: '0.01', value: (s.priceCents / 100).toFixed(2), required: true })),
      h('div.field', h('label', 'Buffer after (min)'), h('input', { name: 'bufferMin', type: 'number', min: 0, max: 240, step: 5, value: s.bufferMin }))),
    h('p.small.muted', 'Buffer = cleanup/reset time blocked after each session. Clients don’t see it.'),
    h('label.check', h('input', { type: 'checkbox', name: 'active', checked: s.active }), 'Show on booking page'));
  const save = h('button.btn-primary', { type: 'button' }, isNew ? 'Add service' : 'Save');
  const actions = [save];
  if (!isNew) {
    actions.unshift(h('button.btn-danger', { type: 'button', onclick: (e) => act(e.currentTarget, m, async () => {
      if (!confirm(`Delete ${s.name}? Services with bookings are hidden instead.`)) return;
      await api(`/api/services/${s.id}`, { method: 'DELETE' }); m.close(); toast('Service removed'); renderServices();
    }) }, 'Delete'));
  }
  const m = openModal(isNew ? 'Add service' : 'Edit service', form, actions);
  save.addEventListener('click', () => {
    if (!form.reportValidity()) return;
    act(save, m, async () => {
      const d = formData(form);
      const body = { name: d.name, description: d.description, durationMin: Number(d.durationMin), priceCents: Math.round(Number(d.price) * 100), bufferMin: Number(d.bufferMin || 0), active: !!d.active };
      await api(isNew ? '/api/services' : `/api/services/${s.id}`, { method: isNew ? 'POST' : 'PUT', body });
      m.close();
      toast(isNew && ctx.therapists.length ? 'Service added — assign it to therapists under Therapists' : (isNew ? 'Service added' : 'Saved'));
      renderServices();
    });
  });
}

// ======================= CLIENTS =======================
async function renderClients() {
  const listEl = h('div.card');
  let timer;
  const search = h('input', { type: 'search', placeholder: 'Search name, email or phone', oninput: () => { clearTimeout(timer); timer = setTimeout(load, 250); }, 'aria-label': 'Search clients' });
  async function load() {
    const { clients } = await api(`/api/clients?q=${encodeURIComponent(search.value)}`);
    listEl.replaceChildren(clients.length ? h('div.table-wrap', h('table',
      h('thead', h('tr', h('th', 'Name'), h('th', 'Contact'), h('th', 'Visits'), h('th', 'Last visit'))),
      h('tbody', clients.map((c) => h('tr', { style: 'cursor:pointer', onclick: () => clientModal(c.id) },
        h('td', h('strong', c.name)), h('td.small', c.email, h('br'), h('span.muted', c.phone)),
        h('td', c.visits), h('td.small', c.lastVisit ? fmtDate(c.lastVisit) : '—'))))))
      : h('p.muted', search.value ? 'No matches.' : 'Clients appear here after their first booking.'));
  }
  page.replaceChildren(h('div.page-head', h('h1', 'Clients')), h('div.field', search), listEl);
  await load();
}

async function clientModal(id) {
  const { client: c, appointments } = await api(`/api/clients/${id}`);
  const name = h('input', { value: c.name });
  const phone = h('input', { value: c.phone, type: 'tel' });
  const notes = h('textarea', { value: c.notes, placeholder: 'Pressure preference, injuries, allergies, health notes…', style: 'min-height:110px' });
  const save = h('button.btn-primary', { type: 'button' }, 'Save');
  const book = h('button', { type: 'button', onclick: async () => { m.close(); await refreshLookups(); newBookingModal({ date: (await api('/api/stats')).today, client: c }); } }, 'Book again');
  const m = openModal(c.name, h('div',
    h('p', h('a', { href: `mailto:${c.email}` }, c.email)),
    h('div.row', h('div.field', h('label', 'Name'), name), h('div.field', h('label', 'Phone'), phone)),
    h('div.field', h('label', 'Client notes (private)'), notes),
    h('h3.section-title', `History (${appointments.length})`),
    appointments.length ? appointments.map((a) => h('div.list-item',
      h('div.grow', h('strong', `${fmtDate(a.date)} · ${fmtTime(a.startMin)}`), h('div.small.muted', `${a.serviceName} with ${a.therapistName}`)),
      h('span.badge', { class: a.status }, STATUS_LABEL[a.status]))) : h('p.small.muted', 'No appointments yet.')), [book, save]);
  save.addEventListener('click', () => act(save, m, async () => {
    await api(`/api/clients/${c.id}`, { method: 'PUT', body: { name: name.value, phone: phone.value, notes: notes.value } });
    m.close(); toast('Client saved'); if (location.hash === '#clients') renderClients();
  }));
}

// ======================= SETTINGS =======================
async function renderSettings() {
  const b = (await api('/api/me')).business;
  ctx.business = b;
  const link = `${location.origin}/b/${b.slug}`;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [b.timezone];
  if (!zones.includes(b.timezone)) zones.unshift(b.timezone);
  const form = h('form.card',
    h('h2', 'Business'),
    h('div.field', h('label', 'Business name'), h('input', { name: 'name', value: b.name, required: true })),
    h('div.row',
      h('div.field', h('label', 'Phone'), h('input', { name: 'phone', value: b.phone, type: 'tel' })),
      h('div.field', h('label', 'Address'), h('input', { name: 'address', value: b.address }))),
    h('div.row',
      h('div.field', h('label', 'Time zone'), h('select', { name: 'timezone' }, zones.map((z) => h('option', { value: z, selected: z === b.timezone }, z)))),
      h('div.field', h('label', 'Currency'), h('input', { name: 'currency', value: b.currency, maxlength: 3, pattern: '[A-Za-z]{3}', required: true }))),
    h('div.field', h('label', 'Booking link'), h('div.row', { style: 'flex-wrap:nowrap;align-items:center;gap:6px' },
      h('span.muted.small', { style: 'flex:none' }, `${location.host}/b/`), h('input', { name: 'slug', value: b.slug, required: true, pattern: '[a-z0-9][a-z0-9-]{1,40}[a-z0-9]' }))),
    h('h2', { style: 'margin-top:20px' }, 'Booking rules'),
    h('div.row',
      h('div.field', h('label', 'Minimum notice (hours)'), h('input', { name: 'leadHours', type: 'number', min: 0, step: '0.5', value: b.leadTimeMin / 60 })),
      h('div.field', h('label', 'Book up to (days ahead)'), h('input', { name: 'bookingWindowDays', type: 'number', min: 1, max: 365, value: b.bookingWindowDays }))),
    h('div.row',
      h('div.field', h('label', 'Online cancellation cutoff (hours)'), h('input', { name: 'cancelCutoffHours', type: 'number', min: 0, value: b.cancelCutoffHours })),
      h('div.field', h('label', 'Start times every'), h('select', { name: 'slotStepMin' }, [10, 15, 20, 30, 60].map((n) => h('option', { value: n, selected: n === b.slotStepMin }, `${n} minutes`))))),
    h('button.btn-primary', { type: 'submit' }, 'Save settings'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    act(btn, null, async () => {
      const d = formData(form);
      const res = await api('/api/business', { method: 'PUT', body: {
        name: d.name, phone: d.phone, address: d.address, timezone: d.timezone, currency: d.currency, slug: d.slug,
        leadTimeMin: Math.round(Number(d.leadHours) * 60), bookingWindowDays: Number(d.bookingWindowDays),
        cancelCutoffHours: Number(d.cancelCutoffHours), slotStepMin: Number(d.slotStepMin),
      } });
      setBusiness(res.business); toast('Settings saved'); renderSettings();
    });
  });
  const linkInput = h('input', { value: link, readonly: true, onfocus: (e) => e.target.select(), 'aria-label': 'Booking link' });
  page.replaceChildren(
    h('div.page-head', h('h1', 'Settings')),
    h('div.card', { style: 'margin-bottom:16px' }, h('h2', 'Your booking page'),
      h('p.muted.small', 'Share this link on your website, social profiles and Google Business listing.'),
      h('div.link-box', linkInput,
        h('button', { type: 'button', onclick: () => navigator.clipboard?.writeText(link).then(() => toast('Link copied')) }, 'Copy'),
        h('a.btn', { href: link, target: '_blank', rel: 'noopener' }, 'Open'))),
    form);
}

function setBusiness(b) {
  ctx.business = b;
  document.getElementById('biz-name').textContent = b.name;
  document.title = `${b.name} — Dashboard`;
  document.getElementById('view-page').href = `/b/${b.slug}`;
}

// ---------- boot ----------
(async function init() {
  try {
    setBusiness((await api('/api/me')).business);
    go(location.hash.slice(1) || 'schedule');
  } catch (e) {
    if (e.status === 401) location.href = '/#login';
    else page.replaceChildren(h('div.error', e.message));
  }
}());
