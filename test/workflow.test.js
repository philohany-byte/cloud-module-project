// Integration test of the business workflow using an in-memory fake of DynamoDB/S3/CloudWatch.
// It checks service logic end to end without Docker. (Real Floci testing is described in the README.)
process.env.USE_LAMBDA = 'false';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const tables = {};
const keyOf = (t, k) => Object.values(k).join('|');
const fakeDb = {
  put: async (t, item) => { (tables[t] ||= new Map()).set(keyOf(t, pickKey(t, item)), item); },
  get: async (t, k) => (tables[t] || new Map()).get(keyOf(t, k)),
  del: async (t, k) => { (tables[t] || new Map()).delete(keyOf(t, k)); },
  scan: async (t) => [...(tables[t] || new Map()).values()],
  query: async (t, pk, val) => [...(tables[t] || new Map()).values()].filter((i) => i[pk] === val),
};
function pickKey(t, i) { return t === 'Assignments' ? { shiftId: i.shiftId, employeeId: i.employeeId } : { k: i.id ?? i.name ?? i.employeeId }; }
const objects = new Map();
const fakeClients = {
  s3: { send: async (cmd) => {
    if (cmd.constructor.name === 'PutObjectCommand') { objects.set(cmd.input.Key, cmd.input.Body); return {}; }
    return { Body: { transformToString: async () => objects.get(cmd.input.Key) } };
  } },
};
const inject = (rel, exports) => { const p = require.resolve(path.join('..', rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
inject('src/aws/db.js', fakeDb);
inject('src/aws/clients.js', fakeClients);
inject('src/aws/audit.js', { audit: () => {} });

const staff = require('../src/services/staff/service');
const scheduling = require('../src/services/scheduling/service');
const swaps = require('../src/services/swap/service');
const mgr = { id: 'mgr', userType: 'manager' };
const futureMonday = '2030-01-07'; // a Monday in the future
const ctx = {};

test('setup: roles, staff and availability', async () => {
  await staff.createRole({ name: 'Cashier', minHeadcount: 1 });
  await staff.createRole({ name: 'Supervisor', minHeadcount: 1 });
  ctx.a = await staff.createEmployee({ name: 'Alice', email: 'a@x.com', password: 'password1', userType: 'staff', roles: ['Cashier'] });
  ctx.b = await staff.createEmployee({ name: 'Bob', email: 'b@x.com', password: 'password1', userType: 'staff', roles: ['Cashier'] });
  ctx.c = await staff.createEmployee({ name: 'Cara', email: 'c@x.com', password: 'password1', userType: 'staff', roles: ['Supervisor'] });
  for (const e of [ctx.a, ctx.b, ctx.c]) await staff.setAvailability(e.id, [{ day: 1, start: '08:00', end: '18:00' }]);
  await assert.rejects(staff.createEmployee({ name: 'Dup', email: 'a@x.com', password: 'password1', userType: 'staff' }), /already in use/);
  await assert.rejects(staff.setAvailability(ctx.a.id, [{ day: 1, start: '09:00', end: '12:00' }, { day: 1, start: '11:00', end: '13:00' }]), /overlap/);
  const cov = await staff.coverage({});
  assert.equal(cov.source, 'local');
  assert.equal(cov.counts.Cashier[1][9], 2);
});

test('scheduling: create shift, validate, assign with business rules', async () => {
  await assert.rejects(scheduling.createShift({ date: futureMonday, start: '17:00', end: '09:00', requirements: { Cashier: 1 } }, mgr), /before end/);
  ctx.s1 = await scheduling.createShift({ date: futureMonday, start: '09:00', end: '13:00', requirements: { Cashier: 1, Supervisor: 1 } }, mgr);
  ctx.s2 = await scheduling.createShift({ date: futureMonday, start: '12:00', end: '16:00', requirements: { Cashier: 1 } }, mgr);
  await scheduling.assign(ctx.s1.id, { employeeId: ctx.a.id, role: 'Cashier' }, mgr);
  await assert.rejects(scheduling.assign(ctx.s1.id, { employeeId: ctx.b.id, role: 'Cashier' }, mgr), /already filled/);
  await assert.rejects(scheduling.assign(ctx.s1.id, { employeeId: ctx.c.id, role: 'Cashier' }, mgr), /does not hold the role/);
  await assert.rejects(scheduling.assign(ctx.s2.id, { employeeId: ctx.a.id, role: 'Cashier' }, mgr), /overlapping shift/);
  const week = await scheduling.weekSchedule(futureMonday, mgr);
  assert.equal(week.shifts.length, 2);
  const own = await scheduling.weekSchedule(futureMonday, { id: ctx.a.id, userType: 'staff' });
  assert.equal(own.shifts.length, 1);
});

test('coverage: flags the shift still missing a Supervisor', async () => {
  const r = await swaps.uncovered({ from: futureMonday, to: '2030-01-13' });
  assert.ok(r.uncovered.some((u) => u.shiftId === ctx.s1.id && u.role === 'Supervisor' && u.missing === 1));
  assert.ok(r.uncovered.some((u) => u.shiftId === ctx.s2.id && u.role === 'Cashier'));
});

test('swap workflow: request -> colleague accepts -> manager approves -> schedule updates', async () => {
  const alice = { id: ctx.a.id, userType: 'staff' };
  const bob = { id: ctx.b.id, userType: 'staff' };
  await assert.rejects(swaps.requestSwap(alice, { shiftId: ctx.s1.id, colleagueId: ctx.c.id }), /does not hold the role/);
  const req = await swaps.requestSwap(alice, { shiftId: ctx.s1.id, colleagueId: ctx.b.id });
  assert.equal(req.status, 'PENDING_COLLEAGUE');
  await assert.rejects(swaps.requestSwap(alice, { shiftId: ctx.s1.id, colleagueId: ctx.b.id }), /open swap request/);
  await assert.rejects(swaps.managerDecide(mgr, req.id, true), /not waiting for the manager/);
  await assert.rejects(swaps.colleagueRespond(alice, req.id, true), /Only the requested colleague/);
  assert.equal((await swaps.colleagueRespond(bob, req.id, true)).status, 'PENDING_MANAGER');
  assert.equal((await swaps.managerDecide(mgr, req.id, true)).status, 'APPROVED');
  assert.ok(await scheduling.getAssignment(ctx.s1.id, ctx.b.id));
  assert.equal(await scheduling.getAssignment(ctx.s1.id, ctx.a.id), undefined);
});

test('swap: declined and rejected requests leave the schedule unchanged', async () => {
  const bob = { id: ctx.b.id, userType: 'staff' };
  const alice = { id: ctx.a.id, userType: 'staff' };
  const r = await swaps.requestSwap(bob, { shiftId: ctx.s1.id, colleagueId: ctx.a.id });
  assert.equal((await swaps.colleagueRespond(alice, r.id, false)).status, 'DECLINED');
  const r2 = await swaps.requestSwap(bob, { shiftId: ctx.s1.id, colleagueId: ctx.a.id });
  await swaps.colleagueRespond(alice, r2.id, true);
  assert.equal((await swaps.managerDecide(mgr, r2.id, false)).status, 'REJECTED');
  assert.ok(await scheduling.getAssignment(ctx.s1.id, ctx.b.id));
});

test('calendar export stores an .ics in S3 and returns it', async () => {
  const out = await scheduling.exportCalendar({ id: ctx.b.id, userType: 'staff' });
  assert.match(out.key, /^calendars\//);
  assert.match(out.content, /BEGIN:VEVENT/);
});

test('cancelling a shift removes its assignments', async () => {
  await scheduling.cancelShift(ctx.s1.id, mgr);
  assert.equal(await scheduling.getAssignment(ctx.s1.id, ctx.b.id), undefined);
});

// ---------- Staff & Availability rules (Felopateer's service) ----------
test('roles: cannot delete a role that upcoming shifts require', async () => {
  await staff.createRole({ name: 'Trainer', minHeadcount: 0 });
  await scheduling.createShift({ date: '2030-01-21', start: '09:00', end: '11:00', requirements: { Trainer: 1 } }, mgr);
  await assert.rejects(staff.deleteRole('Trainer'), /upcoming shifts/);
  await assert.rejects(staff.deleteRole('Cashier'), /still assigned to employees/);
  await assert.rejects(staff.createRole({ name: 'Cashier' }), /already exists/);
});

test('employees: edit details, and block removing a role they are assigned to', async () => {
  const s = await scheduling.createShift({ date: '2030-01-14', start: '09:00', end: '11:00', requirements: { Cashier: 1 } }, mgr);
  await scheduling.assign(s.id, { employeeId: ctx.a.id, role: 'Cashier' }, mgr);
  await assert.rejects(staff.updateEmployee(ctx.a.id, { roles: [] }), /Unassign the shift/);
  const edited = await staff.updateEmployee(ctx.a.id, { name: 'Alice Updated', email: 'ALICE2@x.com' });
  assert.equal(edited.name, 'Alice Updated');
  assert.equal(edited.email, 'alice2@x.com');
  assert.equal(edited.passwordHash, undefined, 'hash must never be returned');
  await assert.rejects(staff.updateEmployee(ctx.a.id, { email: 'b@x.com' }), /already in use/);
  await assert.rejects(staff.updateEmployee(ctx.a.id, { roles: ['Nope'] }), /Unknown role/);
  ctx.s3 = s;
});

test('availability: multiple ranges per day, validation and warnings', async () => {
  await assert.rejects(staff.setAvailability(ctx.a.id, [{ day: 9, start: '09:00', end: '10:00' }]), /day/);
  await assert.rejects(staff.setAvailability(ctx.a.id, [{ day: 1, start: '12:00', end: '09:00' }]), /start before it ends/);
  const ok = await staff.setAvailability(ctx.a.id, [{ day: 1, start: '08:00', end: '10:00' }, { day: 1, start: '13:00', end: '17:00' }]);
  assert.equal(ok.slots.length, 2);
  assert.equal(ok.warnings.length, 1, 'shift 09:00-11:00 is no longer fully covered');
  assert.equal((await staff.getAvailability(ctx.a.id)).submitted, true);
  const all = await staff.listAllAvailability();
  assert.ok(all.every((p) => 'submitted' in p && Array.isArray(p.slots)));
});

test('employees: deleting removes availability and assignments', async () => {
  await staff.deleteEmployee(ctx.a.id, 'mgr');
  assert.equal(await scheduling.getAssignment(ctx.s3.id, ctx.a.id), undefined);
  assert.equal((await staff.getAvailability(ctx.a.id)).submitted, false);
  await assert.rejects(staff.deleteEmployee(ctx.b.id, ctx.b.id), /own account/);
});
