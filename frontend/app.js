// Presentation layer: every piece of data shown here is fetched from the REST API.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // show Monday first
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monday = (d) => { const x = new Date(d + 'T00:00:00Z'); return addDays(d, -((x.getUTCDay() + 6) % 7)); };
const dayName = (d) => DAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
const todayStr = () => new Date().toISOString().slice(0, 10);
const hh = (h) => String(h).padStart(2, '0') + ':00';

let token = localStorage.getItem('token');
let user = JSON.parse(localStorage.getItem('user') || 'null');
let tab = null;
let picked = todayStr();          // day chosen in the calendar; the schedule shows its week
let editing = null;               // employee id being edited
let hours = { from: 8, to: 20 };  // window used by the coverage analysis
const weekOf = () => monday(picked);

function toast(text, err) {
  const el = document.createElement('div');
  if (err) el.className = 'err';
  el.textContent = text;
  $('#msg').replaceChildren(el);
  setTimeout(() => el.remove(), 6000);
}

async function api(method, path, body, raw) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && path !== '/auth/login') { logout(); throw new Error('Session ended, please log in again'); }
  if (raw && res.ok) return res;
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function logout() { token = null; user = null; localStorage.clear(); boot(); }

const TABS = {
  manager: [['schedule', 'Schedule'], ['staff', 'Staff & roles'], ['team', 'Team availability'], ['coverage', 'Coverage analysis'], ['swaps', 'Swaps & uncovered shifts']],
  staff: [['shifts', 'My shifts'], ['availability', 'My availability'], ['swaps', 'Swap requests']],
};

async function boot() {
  $('#login').hidden = !!token;
  $('#app').hidden = !token;
  $('#who').innerHTML = user ? `${esc(user.name)} <span class="badge">${esc(user.userType)}</span> <button class="ghost" data-act="logout">Log out</button>` : '';
  if (!token) return;
  try { user = await api('GET', '/auth/me'); localStorage.setItem('user', JSON.stringify(user)); } catch { return; }
  $('#who').innerHTML = `${esc(user.name)} <span class="badge">${esc(user.userType)}</span> <button class="ghost" data-act="logout">Log out</button>`;
  tab = TABS[user.userType][0][0];
  render();
}

async function render() {
  $('#tabs').innerHTML = TABS[user.userType].map(([id, label]) => `<button class="${id === tab ? 'active' : ''}" data-act="tab" data-id="${id}">${label}</button>`).join('');
  $('#view').innerHTML = '<p class="muted">Loading...</p>';
  try { $('#view').innerHTML = await VIEWS[user.userType][tab](); } catch (e) { $('#view').innerHTML = ''; toast(e.message, true); }
}

const dayPicker = () => `<div class="card row"><label>Pick a day from the calendar<input type="date" data-weekpick value="${picked}"></label>
  <button type="button" class="ghost" data-act="today">Today</button>
  <span>Showing the week <strong>${weekOf()}</strong> to <strong>${addDays(weekOf(), 6)}</strong></span></div>`;
const fmtCoverage = (c) => c.map((x) => `<span class="chip ${x.filled >= x.required ? 'ok' : 'short'}">${esc(x.role)} ${x.filled}/${x.required}</span>`).join('');
const slotRow = (s) => `<div class="row slot"><label>From<input type="time" class="s" value="${esc(s.start)}" required></label><label>To<input type="time" class="e" value="${esc(s.end)}" required></label><button type="button" class="danger" data-act="removeSlot">Remove</button></div>`;
const slotText = (slots, d) => slots.filter((s) => s.day === d).map((s) => `${esc(s.start)}-${esc(s.end)}`).join('<br>') || '<span class="muted">-</span>';

// Join consecutive hours with the same shortage into one line, e.g. "Cashier, Monday 08:00-10:00".
function groupGaps(gaps) {
  const out = [];
  for (const g of gaps) {
    const last = out[out.length - 1];
    if (last && last.role === g.role && last.day === g.day && last.available === g.available && last.end === g.hour) last.end = g.hour + 1;
    else out.push({ ...g, start: g.hour, end: g.hour + 1 });
  }
  return out.sort((a, b) => a.role.localeCompare(b.role) || ORDER.indexOf(a.day) - ORDER.indexOf(b.day) || a.start - b.start);
}

const VIEWS = {
  manager: {
    async schedule() {
      const [sch, roles, people] = await Promise.all([api('GET', '/schedule/week?weekStart=' + weekOf()), api('GET', '/staff/roles'), api('GET', '/staff/employees')]);
      const staff = people.filter((p) => p.userType === 'staff');
      const rows = sch.shifts.map((s) => `<tr class="${s.date === picked ? 'picked' : ''}">
        <td>${esc(s.date)}<br><span class="muted">${dayName(s.date)}</span></td>
        <td>${esc(s.start)}-${esc(s.end)}<br>${esc(s.title)}</td>
        <td>${fmtCoverage(s.coverage)}</td>
        <td>${s.assignments.map((a) => `<span class="chip">${esc(a.name)} (${esc(a.role)}) <a href="#" data-act="unassign" data-shift="${s.id}" data-emp="${a.employeeId}">x</a></span>`).join('')}</td>
        <td><form data-form="assign" data-shift="${s.id}" class="row">
          <select name="employeeId">${staff.map((p) => `<option value="${p.id}">${esc(p.name)} [${esc(p.roles.join(', '))}]</option>`).join('')}</select>
          <select name="role">${Object.keys(s.requirements).map((r) => `<option>${esc(r)}</option>`).join('')}</select>
          <button>Assign</button></form>
          <button class="danger" data-act="cancelShift" data-id="${s.id}">Cancel shift</button></td></tr>`).join('');
      return `${dayPicker()}
      <div class="card"><h2>Create shift</h2><form data-form="createShift"><div class="row">
        <label>Date (choose from calendar) <input type="date" name="date" min="${todayStr()}" value="${picked >= todayStr() ? picked : ''}" required></label>
        <label>Start <input type="time" name="start" required></label>
        <label>End <input type="time" name="end" required></label>
        <label>Title (optional) <input name="title" maxlength="80"></label></div>
        <h3>Staff needed per role</h3><div class="row">${roles.map((r) => `<label>${esc(r.name)} <input type="number" min="0" max="50" value="0" name="req:${esc(r.name)}"></label>`).join('') || '<span class="muted">Create roles first.</span>'}
        <button>Create shift</button></div></form></div>
      <div class="card tablewrap"><h2>Weekly schedule</h2>${rows ? `<table><tr><th>Date</th><th>Time</th><th>Coverage</th><th>Assigned</th><th>Actions</th></tr>${rows}</table>` : '<p class="muted">No shifts this week.</p>'}</div>`;
    },

    async staff() {
      const [roles, people] = await Promise.all([api('GET', '/staff/roles'), api('GET', '/staff/employees')]);
      const roleBoxes = (have) => roles.map((r) => `<label><input type="checkbox" name="role:${esc(r.name)}" style="width:auto;display:inline" ${have.includes(r.name) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('');
      const empRows = people.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${esc(p.userType)}</td>
          <td>${p.roles.map((r) => `<span class="chip">${esc(r)}</span>`).join('') || '<span class="muted">-</span>'}</td>
          <td><button class="ghost" data-act="editEmp" data-id="${p.id}">Edit</button> ${p.id !== user.id ? `<button class="danger" data-act="deleteEmp" data-id="${p.id}">Delete</button>` : ''}</td></tr>
          ${editing === p.id ? `<tr><td colspan="5"><form data-form="editEmployee" data-id="${p.id}" data-type="${p.userType}"><div class="row">
            <label>Name <input name="name" value="${esc(p.name)}" required></label>
            <label>Email <input type="email" name="email" value="${esc(p.email)}" required></label>
            <label>New password (leave empty to keep) <input type="password" name="password" minlength="5"></label></div>
            ${p.userType === 'staff' ? `<div class="row">${roleBoxes(p.roles)}</div>` : ''}
            <div class="row"><button>Save changes</button><button type="button" class="ghost" data-act="cancelEdit">Cancel</button></div></form></td></tr>` : ''}`).join('');
      return `<div class="card tablewrap"><h2>Job roles</h2>
        <table><tr><th>Role</th><th>Minimum people available per hour</th><th></th></tr>${roles.map((r) => `<tr><td>${esc(r.name)}</td>
          <td><form data-form="updateRole" data-name="${esc(r.name)}" class="row"><input type="number" name="minHeadcount" min="0" max="50" value="${r.minHeadcount}" style="width:80px"><button class="ghost">Save</button></form></td>
          <td><button class="danger" data-act="deleteRole" data-name="${esc(r.name)}">Delete</button></td></tr>`).join('')}</table>
        <h3>Add a job role</h3><form data-form="createRole" class="row"><label>Role name <input name="name" required maxlength="40"></label><label>Minimum headcount <input type="number" name="minHeadcount" min="0" max="50" value="1"></label><button>Add role</button></form></div>
        <div class="card tablewrap"><h2>Employees (${people.length})</h2>
        <table><tr><th>Name</th><th>Email</th><th>Type</th><th>Job roles</th><th></th></tr>${empRows}</table>
        <h3>Add an employee</h3><form data-form="createEmployee"><div class="row">
          <label>Name <input name="name" required></label><label>Email <input type="email" name="email" required></label>
          <label>Password (min 5) <input type="password" name="password" minlength="5" required></label>
          <label>Type <select name="userType"><option value="staff">Staff</option><option value="manager">Manager</option></select></label></div>
          <div class="row">${roleBoxes([])}<button>Add employee</button></div></form></div>`;
    },

    async team() {
      const list = await api('GET', '/staff/availability');
      const done = list.filter((p) => p.submitted).length;
      return `<div class="card tablewrap"><h2>Team availability</h2>
        <p class="muted">${done} of ${list.length} staff members have submitted their availability.</p>
        ${list.length ? `<table class="team"><tr><th>Employee</th><th>Job roles</th>${ORDER.map((d) => `<th>${DAYS[d].slice(0, 3)}</th>`).join('')}</tr>
        ${list.map((p) => `<tr><td>${esc(p.name)}${p.submitted ? '' : '<br><span class="chip warn">not submitted</span>'}</td><td>${p.roles.map((r) => `<span class="chip">${esc(r)}</span>`).join('')}</td>${ORDER.map((d) => `<td>${slotText(p.slots, d)}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="muted">No staff members yet.</p>'}</div>`;
    },

    async coverage() {
      const c = await api('GET', `/staff/coverage?fromHour=${hours.from}&toHour=${hours.to}`);
      const hrs = Array.from({ length: c.window.toHour - c.window.fromHour }, (_, i) => c.window.fromHour + i);
      const cls = (n, min) => (n === 0 ? 'none' : n < min ? 'low' : 'good');
      const maps = c.roles.map((r) => `<h3>${esc(r.name)} <span class="muted">(minimum ${r.minHeadcount})</span></h3><div class="tablewrap"><table class="heat"><tr><th></th>${hrs.map((h) => `<th>${h}</th>`).join('')}</tr>
        ${ORDER.map((d) => `<tr><th>${DAYS[d].slice(0, 3)}</th>${hrs.map((h) => { const n = c.counts[r.name][d][h]; return `<td class="${cls(n, r.minHeadcount)}">${n}</td>`; }).join('')}</tr>`).join('')}</table></div>`).join('');
      const groups = groupGaps(c.gaps);
      return `<div class="card"><h2>Availability coverage analysis</h2>
        <form data-form="coverageWindow" class="row"><label>From hour (0-23)<input type="number" name="from" min="0" max="23" value="${hours.from}"></label><label>To hour (1-24)<input type="number" name="to" min="1" max="24" value="${hours.to}"></label><button>Analyse</button></form>
        <p class="muted">Each cell shows how many employees can work that role during that whole hour. Calculated by: <strong>${esc(c.source)}</strong>.</p>
        <p class="legend"><span class="none">Nobody available</span><span class="low">Below the minimum</span><span class="good">Minimum met</span></p>
        ${c.roles.length ? maps : '<p class="muted">Create job roles first.</p>'}</div>
        <div class="card"><h2>Problem time slots (${groups.length})</h2>
        ${groups.length ? `<table><tr><th>Role</th><th>Day</th><th>Hours</th><th>Available</th><th>Minimum</th></tr>${groups.map((g) => `<tr><td>${esc(g.role)}</td><td>${DAYS[g.day]}</td><td>${hh(g.start)}-${hh(g.end)}</td><td>${g.available === 0 ? '<span class="chip short">nobody</span>' : g.available}</td><td>${g.minimum}</td></tr>`).join('')}</table>` : '<p class="ok">Every role meets its minimum in this time window.</p>'}
        <h3>Employees who have not submitted availability (${c.notSubmitted.length})</h3>${c.notSubmitted.length ? c.notSubmitted.map((n) => `<span class="chip warn">${esc(n.name)}</span>`).join('') : '<p class="ok">Everyone has submitted.</p>'}</div>`;
    },

    async swaps() {
      const [u, list] = await Promise.all([api('GET', `/swaps/coverage/uncovered?from=${weekOf()}&to=${addDays(weekOf(), 6)}`), api('GET', '/swaps')]);
      return `${dayPicker()}<div class="card tablewrap"><h2>Uncovered shifts (checked ${u.checked}, via ${esc(u.source)})</h2>${u.uncovered.length ? `<table><tr><th>Date</th><th>Time</th><th>Role</th><th>Assigned / required</th></tr>${u.uncovered.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.start)}-${esc(x.end)}</td><td>${esc(x.role)}</td><td><span class="chip short">${x.assigned}/${x.required} (missing ${x.missing})</span></td></tr>`).join('')}</table>` : '<p class="ok">All shifts this week are fully staffed.</p>'}</div>
        <div class="card tablewrap"><h2>Swap requests</h2>${swapTable(list)}</div>`;
    },
  },

  staff: {
    async shifts() {
      const [sch, colleagues] = await Promise.all([api('GET', '/schedule/week?weekStart=' + weekOf()), api('GET', '/staff/colleagues')]);
      const rows = sch.shifts.map((s) => { const mine = s.assignments[0]; return `<tr><td>${esc(s.date)} <span class="muted">${dayName(s.date)}</span></td><td>${esc(s.start)}-${esc(s.end)}</td><td>${esc(s.title)}</td><td>${esc(mine.role)}</td><td>
        <form data-form="requestSwap" data-shift="${s.id}" class="row"><select name="colleagueId">${colleagues.filter((c) => c.roles.includes(mine.role)).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">No colleague with this role</option>'}</select><input name="note" placeholder="Note (optional)" maxlength="200"><button>Request swap</button></form></td></tr>`; }).join('');
      return `${dayPicker()}<div class="card tablewrap"><div class="row"><h2>My shifts</h2><button class="ghost" data-act="export">Export upcoming shifts to calendar (.ics)</button></div>
        ${rows ? `<table><tr><th>Date</th><th>Time</th><th>Title</th><th>My role</th><th>Swap</th></tr>${rows}</table>` : '<p class="muted">You have no shifts this week.</p>'}</div>`;
    },
    async availability() {
      const a = await api('GET', '/staff/availability/me');
      return `<div class="card"><h2>My availability</h2><p class="muted">${a.submitted ? 'Update the days and hours you can work.' : 'You have not submitted your availability yet.'} Add as many time ranges per day as you need.</p>
        <form data-form="availability">${ORDER.map((d) => `<div class="card" data-day="${d}"><strong>${DAYS[d]}</strong><div class="slots">${a.slots.filter((s) => s.day === d).map(slotRow).join('')}</div>
          <button type="button" class="ghost" data-act="addSlot" data-day="${d}">+ Add time range</button></div>`).join('')}
        <button>Save availability</button></form></div>`;
    },
    async swaps() { return `<div class="card tablewrap"><h2>Swap requests</h2>${swapTable(await api('GET', '/swaps'))}</div>`; },
  },
};

function swapTable(list) {
  if (!list.length) return '<p class="muted">No swap requests.</p>';
  return `<table><tr><th>Shift</th><th>From</th><th>To</th><th>Status</th><th>Actions</th></tr>${list.map((r) => {
    let act = '';
    if (user.userType === 'staff') {
      if (r.status === 'PENDING_COLLEAGUE' && r.colleagueId === user.id) act = `<button data-act="respond" data-id="${r.id}" data-accept="true">Accept</button> <button class="danger" data-act="respond" data-id="${r.id}" data-accept="false">Decline</button>`;
      if (['PENDING_COLLEAGUE', 'PENDING_MANAGER'].includes(r.status) && r.requesterId === user.id) act += `<button class="ghost" data-act="cancelSwap" data-id="${r.id}">Cancel request</button>`;
    } else if (r.status === 'PENDING_MANAGER') {
      act = `<button data-act="decide" data-id="${r.id}" data-approve="true">Approve</button> <button class="danger" data-act="decide" data-id="${r.id}" data-approve="false">Reject</button>`;
    }
    return `<tr><td>${r.shift ? `${esc(r.shift.date)} ${esc(r.shift.start)}-${esc(r.shift.end)}` : 'removed'} (${esc(r.role)})</td><td>${esc(r.requesterName)}</td><td>${esc(r.colleagueName)}</td><td><span class="chip">${esc(r.status.replace('_', ' '))}</span></td><td>${act}</td></tr>`;
  }).join('')}</table>`;
}

// ---------- event handling ----------
const checkedRoles = (fd) => [...fd.keys()].filter((k) => k.startsWith('role:')).map((k) => k.slice(5));

const ACTIONS = {
  logout, tab(d) { tab = d.id; editing = null; render(); },
  today() { picked = todayStr(); render(); },
  editEmp(d) { editing = d.id; render(); },
  cancelEdit() { editing = null; render(); },
  addSlot(d) { document.querySelector(`[data-day="${d.day}"] .slots`).insertAdjacentHTML('beforeend', slotRow({ start: '09:00', end: '17:00' })); },
  removeSlot(d, el) { el.closest('.slot').remove(); },
  async unassign(d) { await api('DELETE', `/shifts/${d.shift}/assignments/${d.emp}`); toast('Employee removed from shift'); render(); },
  async cancelShift(d) { if (confirm('Cancel this shift?')) { await api('PATCH', `/shifts/${d.id}/cancel`); toast('Shift cancelled'); render(); } },
  async deleteRole(d) { if (confirm(`Delete role ${d.name}?`)) { await api('DELETE', `/staff/roles/${encodeURIComponent(d.name)}`); toast('Role deleted'); render(); } },
  async deleteEmp(d) { if (confirm('Delete this employee? Their shift assignments will be removed.')) { await api('DELETE', `/staff/employees/${d.id}`); toast('Employee deleted'); render(); } },
  async respond(d) { await api('PATCH', `/swaps/${d.id}/colleague-response`, { accept: d.accept === 'true' }); toast('Response sent'); render(); },
  async decide(d) { await api('PATCH', `/swaps/${d.id}/manager-decision`, { approve: d.approve === 'true' }); toast(d.approve === 'true' ? 'Swap approved and schedule updated' : 'Swap rejected'); render(); },
  async cancelSwap(d) { await api('PATCH', `/swaps/${d.id}/cancel`); toast('Request cancelled'); render(); },
  async export() {
    const res = await api('GET', '/schedule/calendar.ics', null, true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob()); a.download = 'my-shifts.ics'; a.click();
    URL.revokeObjectURL(a.href);
    toast('Calendar file downloaded - open it to add the shifts to your calendar');
  },
};

const FORMS = {
  async login(f, fd) {
    const r = await api('POST', '/auth/login', { email: fd.get('email'), password: fd.get('password') });
    token = r.token; user = r.user; localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); boot();
  },
  async createShift(f, fd) {
    const requirements = {};
    for (const [k, val] of fd.entries()) if (k.startsWith('req:') && Number(val) > 0) requirements[k.slice(4)] = Number(val);
    await api('POST', '/shifts', { date: fd.get('date'), start: fd.get('start'), end: fd.get('end'), title: fd.get('title'), requirements });
    picked = fd.get('date'); toast('Shift created'); render();
  },
  async assign(f, fd) { await api('POST', `/shifts/${f.dataset.shift}/assignments`, { employeeId: fd.get('employeeId'), role: fd.get('role') }); toast('Employee assigned'); render(); },
  async createRole(f, fd) { await api('POST', '/staff/roles', { name: fd.get('name'), minHeadcount: Number(fd.get('minHeadcount')) }); toast('Role added'); render(); },
  async updateRole(f, fd) { await api('PUT', `/staff/roles/${encodeURIComponent(f.dataset.name)}`, { minHeadcount: Number(fd.get('minHeadcount')) }); toast('Minimum headcount saved'); render(); },
  async createEmployee(f, fd) {
    await api('POST', '/staff/employees', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), userType: fd.get('userType'), roles: checkedRoles(fd) });
    toast('Employee added'); render();
  },
  async editEmployee(f, fd) {
    const body = { name: fd.get('name'), email: fd.get('email') };
    if (fd.get('password')) body.password = fd.get('password');
    if (f.dataset.type === 'staff') body.roles = checkedRoles(fd);
    await api('PUT', `/staff/employees/${f.dataset.id}`, body);
    editing = null; toast('Employee updated'); render();
  },
  async availability(f) {
    const slots = [];
    f.querySelectorAll('[data-day]').forEach((box) => box.querySelectorAll('.slot').forEach((row) => {
      slots.push({ day: Number(box.dataset.day), start: row.querySelector('.s').value, end: row.querySelector('.e').value });
    }));
    const r = await api('PUT', '/staff/availability/me', { slots });
    if (r.warnings && r.warnings.length) toast('Saved, but: ' + r.warnings.join(' '), true); else toast('Availability saved');
    render();
  },
  coverageWindow(f, fd) { hours = { from: Number(fd.get('from')), to: Number(fd.get('to')) }; render(); },
  async requestSwap(f, fd) { await api('POST', '/swaps', { shiftId: f.dataset.shift, colleagueId: fd.get('colleagueId'), note: fd.get('note') }); toast('Swap request sent'); },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  try { await ACTIONS[el.dataset.act](el.dataset, el); } catch (err) { toast(err.message, true); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  try { await FORMS[f.dataset.form](f, new FormData(f)); } catch (err) { toast(err.message, true); }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-weekpick]') && e.target.value) { picked = e.target.value; render(); }
});

boot();
