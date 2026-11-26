// Unit tests for pure business logic (no AWS, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyse } = require('../lambdas/coverage-analysis/logic');
const { findUncovered } = require('../lambdas/uncovered-shifts/logic');
const { buildICS } = require('../src/services/scheduling/ics');
const { overlaps, weekStartOf, addDays } = require('../src/shared/time');
const v = require('../src/shared/validate');

test('coverage: counts people per role per hour and flags gaps', () => {
  const roles = [{ name: 'Cashier', minHeadcount: 2 }];
  const employees = [
    { id: '1', name: 'A', roles: ['Cashier'], submitted: true, availability: [{ day: 1, start: '08:00', end: '12:00' }] },
    { id: '2', name: 'B', roles: ['Cashier'], submitted: true, availability: [{ day: 1, start: '10:00', end: '12:00' }] },
    { id: '3', name: 'C', roles: ['Cashier'], submitted: false, availability: [] },
  ];
  const r = analyse({ employees, roles, fromHour: 8, toHour: 12 });
  assert.equal(r.counts.Cashier[1][8], 1);
  assert.equal(r.counts.Cashier[1][10], 2);
  assert.ok(r.gaps.some((g) => g.day === 1 && g.hour === 8 && g.available === 1), 'hour 8 is below minimum');
  assert.ok(!r.gaps.some((g) => g.day === 1 && g.hour === 10), 'hour 10 meets the minimum');
  assert.ok(r.gaps.some((g) => g.day === 0), 'Sunday has nobody available');
  assert.deepEqual(r.notSubmitted, [{ id: '3', name: 'C' }]);
});

test('uncovered shifts: reports missing headcount per role and ignores cancelled shifts', () => {
  const shifts = [
    { id: 's1', date: '2026-12-01', start: '09:00', end: '17:00', status: 'scheduled', requirements: { Cashier: 2, Supervisor: 1 }, assigned: [{ role: 'Cashier' }, { role: 'Supervisor' }] },
    { id: 's2', date: '2026-12-02', start: '09:00', end: '17:00', status: 'cancelled', requirements: { Cashier: 1 }, assigned: [] },
  ];
  const r = findUncovered({ shifts });
  assert.equal(r.uncovered.length, 1);
  assert.deepEqual([r.uncovered[0].role, r.uncovered[0].missing], ['Cashier', 1]);
});

test('time helpers', () => {
  assert.ok(overlaps({ date: 'd', start: '09:00', end: '12:00' }, { date: 'd', start: '11:00', end: '14:00' }));
  assert.ok(!overlaps({ date: 'd', start: '09:00', end: '12:00' }, { date: 'd', start: '12:00', end: '14:00' }));
  assert.equal(weekStartOf('2026-11-25'), '2026-11-23'); // Wednesday -> Monday
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('validators reject bad input', () => {
  assert.throws(() => v.time('25:00', 't'), /HH:MM/);
  assert.throws(() => v.date('2026-02-30'), /valid date/);
  assert.throws(() => v.email('nope'), /email/);
  assert.throws(() => v.int(1.5, 'n', 0, 5), /whole number/);
  assert.equal(v.email(' A@B.COM '), 'a@b.com');
});

test('ICS file contains one event per shift', () => {
  const ics = buildICS('Test', [{ id: 'x', date: '2026-11-30', start: '09:00', end: '17:00', title: 'Opening', role: 'Cashier' }], new Date('2026-11-25T12:00:00Z'));
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20261130T090000/);
  assert.match(ics, /DTSTAMP:20261125T120000Z/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});
