// APPLICATION LAYER - Staff & Availability service (owner: Felopateer Hany)
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const repo = require('./repository');
const v = require('../../shared/validate');
const { HttpError } = require('../../shared/errors');
const { sign } = require('../../shared/auth');
const { toMin, dayOfWeek } = require('../../shared/time');
const { runFunction } = require('../../aws/invoke');
const config = require('../../config');
const { analyse } = require('../../../lambdas/coverage-analysis/logic');

const scheduling = () => require('../scheduling/service'); // loaded lazily (the services use each other)
const PASSWORD = { min: 5, max: 100 };
const pub = (e) => { const { passwordHash, ...rest } = e; return rest; }; // never expose the hash

// ---------- 1. Login ----------
async function login(body) {
  const email = v.email(body.email);
  const password = v.str(body.password, 'password', { max: 200 });
  const e = await repo.findByEmail(email);
  if (!e || !(await bcrypt.compare(password, e.passwordHash))) throw new HttpError(401, 'Invalid email or password');
  return { token: sign(e), user: pub(e) };
}

// ---------- 2. Employees and job roles ----------
async function validRoles(roles) {
  if (!Array.isArray(roles)) v.bad('roles must be a list of role names');
  const known = new Set((await repo.listRoles()).map((r) => r.name));
  for (const r of roles) if (!known.has(r)) v.bad(`Unknown role: ${r}`);
  return [...new Set(roles)];
}

async function createEmployee(b) {
  const email = v.email(b.email);
  if (await repo.findByEmail(email)) throw new HttpError(409, 'Email already in use');
  if (!['manager', 'staff'].includes(b.userType)) v.bad('userType must be "manager" or "staff"');
  const e = {
    id: crypto.randomUUID(),
    name: v.str(b.name, 'name'),
    email,
    userType: b.userType,
    roles: b.userType === 'staff' ? await validRoles(b.roles || []) : [],
    passwordHash: await bcrypt.hash(v.str(b.password, 'password', PASSWORD), 8),
    createdAt: new Date().toISOString(),
  };
  await repo.saveEmployee(e);
  return pub(e);
}

async function getEmployee(id) {
  const e = await repo.getEmployee(id);
  return e ? pub(e) : null;
}
async function getEmployeeOr404(id) {
  const e = await getEmployee(id);
  if (!e) throw new HttpError(404, 'Employee not found');
  return e;
}
async function listEmployees() { return (await repo.listEmployees()).map(pub); }
async function listStaff() {
  return (await listEmployees()).filter((e) => e.userType === 'staff')
    .map(({ id, name, email, roles }) => ({ id, name, email, roles }));
}

async function updateEmployee(id, b) {
  const raw = await repo.getEmployee(id);
  if (!raw) throw new HttpError(404, 'Employee not found');
  const e = { ...raw };
  if (b.name !== undefined) e.name = v.str(b.name, 'name');
  if (b.email !== undefined) {
    const email = v.email(b.email);
    const other = await repo.findByEmail(email);
    if (other && other.id !== id) throw new HttpError(409, 'Email already in use');
    e.email = email;
  }
  if (b.roles !== undefined) {
    const roles = e.userType === 'staff' ? await validRoles(b.roles) : [];
    const removed = raw.roles.filter((r) => !roles.includes(r));
    if (removed.length) { // do not leave an employee assigned to a role they no longer hold
      const clash = (await scheduling().upcomingShiftsOf(id)).find((s) => removed.includes(s.role));
      if (clash) throw new HttpError(409, `${raw.name} is assigned as ${clash.role} on ${clash.date}. Unassign the shift before removing the role.`);
    }
    e.roles = roles;
  }
  if (b.password !== undefined) e.passwordHash = await bcrypt.hash(v.str(b.password, 'password', PASSWORD), 8);
  await repo.saveEmployee(e);
  return pub(e);
}

async function deleteEmployee(id, actorId) {
  if (id === actorId) v.bad('You cannot delete your own account');
  await getEmployeeOr404(id);
  await repo.deleteEmployee(id);
  await repo.deleteAvailability(id);
  await scheduling().removeAssignmentsOf(id); // keep the schedule consistent
}

// Roles carry the minimum headcount used by the availability analysis.
async function listRoles() { return (await repo.listRoles()).sort((a, b) => a.name.localeCompare(b.name)); }
async function createRole(b) {
  const name = v.str(b.name, 'name', { max: 40 });
  if (await repo.getRole(name)) throw new HttpError(409, 'Role already exists');
  const role = { name, minHeadcount: v.int(b.minHeadcount ?? 1, 'minHeadcount', 0, 50) };
  await repo.saveRole(role);
  return role;
}
async function updateRole(name, b) {
  const role = await repo.getRole(name);
  if (!role) throw new HttpError(404, 'Role not found');
  role.minHeadcount = v.int(b.minHeadcount, 'minHeadcount', 0, 50);
  await repo.saveRole(role);
  return role;
}
async function deleteRole(name) {
  if (!(await repo.getRole(name))) throw new HttpError(404, 'Role not found');
  if ((await listEmployees()).some((e) => e.roles.includes(name))) throw new HttpError(409, 'Role is still assigned to employees');
  if (await scheduling().roleInUse(name)) throw new HttpError(409, 'Role is required by upcoming shifts');
  await repo.deleteRole(name);
}

// ---------- 3. Availability ----------
function validSlots(slots) {
  if (!Array.isArray(slots) || slots.length > 50) v.bad('slots must be a list (max 50)');
  const out = slots.map((s) => ({
    day: v.int(s.day, 'day', 0, 6),
    start: v.time(s.start, 'start'),
    end: v.time(s.end, 'end'),
  }));
  for (const s of out) if (toMin(s.start) >= toMin(s.end)) v.bad('A slot must start before it ends');
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]; const b = out[j];
      if (a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)) v.bad('Availability slots must not overlap on the same day');
    }
  }
  return out;
}
async function setAvailability(employeeId, slots) {
  const e = await getEmployeeOr404(employeeId);
  if (e.userType !== 'staff') throw new HttpError(409, 'Only staff members have availability');
  const a = { employeeId, slots: validSlots(slots), updatedAt: new Date().toISOString() };
  await repo.saveAvailability(a);
  // Tell the employee if the new availability no longer covers a shift they are already assigned to.
  const warnings = (await scheduling().upcomingShiftsOf(employeeId))
    .filter((s) => !covers(a.slots, s.date, s.start, s.end))
    .map((s) => `Your shift on ${s.date} (${s.start}-${s.end}) is no longer covered by your availability. Please contact your manager.`);
  return { ...a, submitted: true, warnings };
}
async function getAvailability(employeeId) {
  const a = await repo.getAvailability(employeeId);
  return a ? { ...a, submitted: true } : { employeeId, slots: [], submitted: false };
}
async function listAllAvailability() {
  const [staff, all] = await Promise.all([listStaff(), repo.listAvailability()]);
  const byId = Object.fromEntries(all.map((a) => [a.employeeId, a]));
  return staff.map((s) => ({ ...s, submitted: Boolean(byId[s.id]), slots: byId[s.id]?.slots || [] }));
}
// Used by the Shift Scheduling service when assigning staff.
const covers = (slots, date, start, end) => {
  const day = dayOfWeek(date);
  return slots.some((s) => s.day === day && toMin(s.start) <= toMin(start) && toMin(s.end) >= toMin(end));
};
async function isAvailable(employeeId, date, start, end) {
  const a = await repo.getAvailability(employeeId);
  return Boolean(a && covers(a.slots, date, start, end));
}

// ---------- 4. Availability coverage analysis (runs on AWS Lambda) ----------
async function coverage({ fromHour = 8, toHour = 20 } = {}) {
  const from = Number(fromHour); const to = Number(toHour);
  v.int(from, 'fromHour', 0, 23); v.int(to, 'toHour', 1, 24);
  if (from >= to) v.bad('fromHour must be smaller than toHour');
  const [people, roles] = await Promise.all([listAllAvailability(), listRoles()]);
  const employees = people.map((p) => ({ id: p.id, name: p.name, roles: p.roles, submitted: p.submitted, availability: p.slots }));
  const { result, source } = await runFunction(config.lambdas.coverage, { employees, roles, fromHour: from, toHour: to }, analyse);
  return { ...result, roles, source };
}

module.exports = {
  login, createEmployee, getEmployee, getEmployeeOr404, listEmployees, listStaff, updateEmployee, deleteEmployee,
  listRoles, createRole, updateRole, deleteRole,
  setAvailability, getAvailability, listAllAvailability, isAvailable, coverage,
};
