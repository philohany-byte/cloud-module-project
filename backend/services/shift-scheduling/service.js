// APPLICATION LAYER - Shift Scheduling service (owner: Abdelrahman Ayman)
const crypto = require('crypto');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const repo = require('../../../database/shift-scheduling/repository');
const staff = require('../staff-availability/service');
const v = require('../../shared/validate');
const { HttpError } = require('../../shared/errors');
const { toMin, overlaps, addDays, today, weekStartOf } = require('../../shared/time');
const { s3 } = require('../../../database/clients');
const { audit } = require('../../aws/audit');
const config = require('../../config');
const { buildICS } = require('./ics');

const byTime = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);

async function validRequirements(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req) || Object.keys(req).length === 0) {
    v.bad('requirements must list at least one role with a headcount');
  }
  const known = new Set((await staff.listRoles()).map((r) => r.name));
  const out = {};
  for (const [role, n] of Object.entries(req)) {
    if (!known.has(role)) v.bad(`Unknown role: ${role}`);
    out[role] = v.int(n, `headcount for ${role}`, 1, 50);
  }
  return out;
}

async function getShift(id) { return repo.getShift(id); }
async function getShiftOr404(id) {
  const s = await repo.getShift(id);
  if (!s) throw new HttpError(404, 'Shift not found');
  return s;
}

// ---------- 1. Create / edit / cancel shifts ----------
async function createShift(b, actor) {
  const date = v.date(b.date);
  const start = v.time(b.start, 'start');
  const end = v.time(b.end, 'end');
  if (toMin(start) >= toMin(end)) v.bad('start must be before end (overnight shifts are not supported)');
  if (date < today()) v.bad('Shifts cannot be created in the past');
  const shift = {
    id: crypto.randomUUID(), date, start, end,
    title: b.title ? v.str(b.title, 'title', { max: 80 }) : '',
    requirements: await validRequirements(b.requirements),
    status: 'scheduled', createdBy: actor.id, createdAt: new Date().toISOString(),
  };
  await repo.saveShift(shift);
  audit('scheduling', { event: 'shift.created', shiftId: shift.id, by: actor.id });
  return shift;
}

async function updateShift(id, b, actor) {
  const s = await getShiftOr404(id);
  if (s.status !== 'scheduled') throw new HttpError(409, 'Cancelled shifts cannot be edited');
  const assigned = await repo.assignmentsByShift(id);
  const n = { ...s };
  if (b.date !== undefined) n.date = v.date(b.date);
  if (b.start !== undefined) n.start = v.time(b.start, 'start');
  if (b.end !== undefined) n.end = v.time(b.end, 'end');
  if (b.title !== undefined) n.title = b.title ? v.str(b.title, 'title', { max: 80 }) : '';
  if (b.requirements !== undefined) n.requirements = await validRequirements(b.requirements);
  if (toMin(n.start) >= toMin(n.end)) v.bad('start must be before end');
  if (n.date !== s.date && n.date < today()) v.bad('Shifts cannot be moved into the past');
  if ((n.date !== s.date || n.start !== s.start || n.end !== s.end) && assigned.length) {
    throw new HttpError(409, 'Remove the assigned staff before changing the date or time');
  }
  for (const a of assigned) {
    const need = n.requirements[a.role];
    if (!need || assigned.filter((x) => x.role === a.role).length > need) {
      throw new HttpError(409, `Requirements conflict with current assignments for ${a.role}`);
    }
  }
  await repo.saveShift(n);
  audit('scheduling', { event: 'shift.updated', shiftId: id, by: actor.id });
  return n;
}

async function cancelShift(id, actor) {
  const s = await getShiftOr404(id);
  if (s.status === 'cancelled') throw new HttpError(409, 'Shift is already cancelled');
  await Promise.all((await repo.assignmentsByShift(id)).map((a) => repo.deleteAssignment(id, a.employeeId)));
  const n = { ...s, status: 'cancelled', cancelledAt: new Date().toISOString() };
  await repo.saveShift(n);
  audit('scheduling', { event: 'shift.cancelled', shiftId: id, by: actor.id });
  return n;
}

// ---------- 2. Assign employees (role, availability and overlap checks) ----------
async function shiftsOfEmployee(employeeId) {
  const mine = (await repo.allAssignments()).filter((a) => a.employeeId === employeeId);
  const shifts = await Promise.all(mine.map((a) => repo.getShift(a.shiftId)));
  return shifts.map((s, i) => (s && s.status === 'scheduled' ? { ...s, role: mine[i].role } : null)).filter(Boolean);
}

async function checkAssignable(shift, employeeId, role, { ignoreFull = false } = {}) {
  if (shift.status !== 'scheduled') throw new HttpError(409, 'Shift is not open for assignment');
  if (!(role in shift.requirements)) v.bad(`The shift does not require the role ${role}`);
  const emp = await staff.getEmployee(employeeId);
  if (!emp || emp.userType !== 'staff') throw new HttpError(404, 'Employee not found');
  if (!emp.roles.includes(role)) throw new HttpError(409, `${emp.name} does not hold the role ${role}`);
  if (await repo.getAssignment(shift.id, employeeId)) throw new HttpError(409, `${emp.name} is already assigned to this shift`);
  if (!(await staff.isAvailable(employeeId, shift.date, shift.start, shift.end))) {
    throw new HttpError(409, `${emp.name} has not declared availability for this time`);
  }
  const clash = (await shiftsOfEmployee(employeeId)).find((o) => o.id !== shift.id && overlaps(shift, o));
  if (clash) throw new HttpError(409, `${emp.name} already works an overlapping shift (${clash.date} ${clash.start}-${clash.end})`);
  if (!ignoreFull) {
    const filled = (await repo.assignmentsByShift(shift.id)).filter((a) => a.role === role).length;
    if (filled >= shift.requirements[role]) throw new HttpError(409, `All ${shift.requirements[role]} ${role} places are already filled`);
  }
  return emp;
}

async function assign(shiftId, b, actor) {
  const employeeId = v.str(b.employeeId, 'employeeId', { max: 60 });
  const role = v.str(b.role, 'role', { max: 40 });
  const shift = await getShiftOr404(shiftId);
  await checkAssignable(shift, employeeId, role);
  const a = { shiftId, employeeId, role, assignedAt: new Date().toISOString() };
  await repo.saveAssignment(a);
  audit('scheduling', { event: 'shift.assigned', shiftId, employeeId, role, by: actor.id });
  return a;
}

async function unassign(shiftId, employeeId, actor) {
  if (!(await repo.getAssignment(shiftId, employeeId))) throw new HttpError(404, 'Assignment not found');
  await repo.deleteAssignment(shiftId, employeeId);
  audit('scheduling', { event: 'shift.unassigned', shiftId, employeeId, by: actor.id });
}

async function removeAssignmentsOf(employeeId) {
  const mine = (await repo.allAssignments()).filter((a) => a.employeeId === employeeId);
  await Promise.all(mine.map((a) => repo.deleteAssignment(a.shiftId, employeeId)));
}

// ---------- 3. Weekly schedule ----------
async function weekSchedule(weekStart, user) {
  const start = weekStart ? v.date(weekStart, 'weekStart') : weekStartOf(today());
  const end = addDays(start, 6);
  const [shifts, people] = await Promise.all([repo.listShifts(), staff.listStaff()]);
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const manager = user.userType === 'manager';
  const out = [];
  for (const s of shifts.filter((x) => x.status === 'scheduled' && x.date >= start && x.date <= end).sort(byTime)) {
    const as = await repo.assignmentsByShift(s.id);
    if (!manager && !as.some((a) => a.employeeId === user.id)) continue; // employees only see their own shifts
    out.push({
      ...s,
      assignments: as.filter((a) => manager || a.employeeId === user.id)
        .map((a) => ({ employeeId: a.employeeId, name: names[a.employeeId] || '(removed)', role: a.role })),
      coverage: Object.entries(s.requirements).map(([role, required]) => ({ role, required, filled: as.filter((a) => a.role === role).length })),
    });
  }
  return { weekStart: start, weekEnd: end, shifts: out };
}

// ---------- 4. Calendar export (iCalendar file stored in and served from S3) ----------
async function exportCalendar(user) {
  const emp = await staff.getEmployeeOr404(user.id);
  const upcoming = (await shiftsOfEmployee(user.id)).filter((s) => s.date >= today()).sort(byTime);
  const body = buildICS(`${emp.name} - work shifts`, upcoming);
  const key = `calendars/${user.id}/${Date.now()}.ics`;
  await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: 'text/calendar' }));
  const stored = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  audit('scheduling', { event: 'calendar.exported', employeeId: user.id, key, shifts: upcoming.length });
  return { key, content: await stored.Body.transformToString() };
}

// ---------- Interface used by the Staff & Availability service ----------
async function roleInUse(name) {
  return (await repo.listShifts()).some((s) => s.status === 'scheduled' && s.date >= today() && name in s.requirements);
}
async function upcomingShiftsOf(employeeId) {
  return (await shiftsOfEmployee(employeeId)).filter((s) => s.date >= today());
}

// ---------- Interface used by the Shift Swap & Coverage service ----------
async function getAssignment(shiftId, employeeId) { return repo.getAssignment(shiftId, employeeId); }

async function checkSwapTarget(shiftId, employeeId, role) {
  const shift = await getShiftOr404(shiftId);
  return checkAssignable(shift, employeeId, role, { ignoreFull: true });
}

async function reassign(shiftId, fromId, toId) {
  const current = await repo.getAssignment(shiftId, fromId);
  if (!current) throw new HttpError(409, 'The original employee is no longer assigned to this shift');
  const shift = await getShiftOr404(shiftId);
  await checkAssignable(shift, toId, current.role, { ignoreFull: true });
  await repo.saveAssignment({ shiftId, employeeId: toId, role: current.role, assignedAt: new Date().toISOString(), viaSwap: true });
  await repo.deleteAssignment(shiftId, fromId);
}

async function getShiftsWithAssignments(from, to) {
  const shifts = (await repo.listShifts()).filter((s) => s.status === 'scheduled' && s.date >= from && s.date <= to);
  return Promise.all(shifts.map(async (s) => ({
    id: s.id, date: s.date, start: s.start, end: s.end, title: s.title, status: s.status, requirements: s.requirements,
    assigned: (await repo.assignmentsByShift(s.id)).map((a) => ({ employeeId: a.employeeId, role: a.role })),
  })));
}

module.exports = {
  createShift, updateShift, cancelShift, assign, unassign, removeAssignmentsOf, weekSchedule, exportCalendar,
  roleInUse, upcomingShiftsOf, getShift, getAssignment, checkSwapTarget, reassign, getShiftsWithAssignments,
};
