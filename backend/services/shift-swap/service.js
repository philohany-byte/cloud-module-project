// APPLICATION LAYER - Shift Swap & Coverage service (owner: Yuwei Zhang)
// A swap hands the requester's shift over to a colleague (same role, same shift).
const crypto = require('crypto');
const repo = require('../../../database/shift-swap/repository');
const staff = require('../staff-availability/service');
const scheduling = require('../shift-scheduling/service');
const v = require('../../shared/validate');
const { HttpError } = require('../../shared/errors');
const { today, addDays } = require('../../shared/time');
const { runFunction } = require('../../aws/invoke');
const { audit } = require('../../aws/audit');
const config = require('../../config');
const { findUncovered } = require('./lambda/logic');

const S = { PENDING_COLLEAGUE: 'PENDING_COLLEAGUE', PENDING_MANAGER: 'PENDING_MANAGER', APPROVED: 'APPROVED', REJECTED: 'REJECTED', DECLINED: 'DECLINED', CANCELLED: 'CANCELLED' };
const OPEN = [S.PENDING_COLLEAGUE, S.PENDING_MANAGER];
const step = (r, status, by, note) => {
  r.status = status;
  r.history.push({ status, by, at: new Date().toISOString(), ...(note ? { note } : {}) });
};

async function enrich(r) {
  const [a, b, shift] = await Promise.all([staff.getEmployee(r.requesterId), staff.getEmployee(r.colleagueId), scheduling.getShift(r.shiftId)]);
  return {
    ...r,
    requesterName: a?.name || '(removed)',
    colleagueName: b?.name || '(removed)',
    shift: shift ? { date: shift.date, start: shift.start, end: shift.end, title: shift.title } : null,
  };
}
async function getOr404(id) {
  const r = await repo.get(id);
  if (!r) throw new HttpError(404, 'Swap request not found');
  return r;
}

// ---------- 1. Request a swap ----------
async function requestSwap(user, b) {
  const shiftId = v.str(b.shiftId, 'shiftId', { max: 60 });
  const colleagueId = v.str(b.colleagueId, 'colleagueId', { max: 60 });
  const note = b.note ? v.str(b.note, 'note', { max: 200 }) : undefined;
  if (colleagueId === user.id) v.bad('You cannot swap a shift with yourself');
  const shift = await scheduling.getShift(shiftId);
  if (!shift || shift.status !== 'scheduled') throw new HttpError(404, 'Shift not found');
  if (shift.date < today()) throw new HttpError(409, 'Past shifts cannot be swapped');
  const mine = await scheduling.getAssignment(shiftId, user.id);
  if (!mine) throw new HttpError(409, 'You are not assigned to this shift');
  if ((await repo.list()).some((r) => r.shiftId === shiftId && r.requesterId === user.id && OPEN.includes(r.status))) {
    throw new HttpError(409, 'You already have an open swap request for this shift');
  }
  const colleague = await staff.getEmployee(colleagueId);
  if (!colleague || colleague.userType !== 'staff') throw new HttpError(404, 'Colleague not found');
  await scheduling.checkSwapTarget(shiftId, colleagueId, mine.role); // role, availability, overlap

  const r = { id: crypto.randomUUID(), shiftId, requesterId: user.id, colleagueId, role: mine.role, note, status: '', history: [], createdAt: new Date().toISOString() };
  step(r, S.PENDING_COLLEAGUE, user.id);
  await repo.save(r);
  audit('swaps', { event: 'swap.requested', id: r.id, shiftId, from: user.id, to: colleagueId });
  return enrich(r);
}

async function listSwaps(user) {
  const all = await repo.list();
  const visible = user.userType === 'manager' ? all : all.filter((r) => r.requesterId === user.id || r.colleagueId === user.id);
  return Promise.all(visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(enrich));
}

// ---------- 2. Approval workflow: colleague, then manager ----------
async function colleagueRespond(user, id, accept) {
  if (typeof accept !== 'boolean') v.bad('accept must be true or false');
  const r = await getOr404(id);
  if (r.colleagueId !== user.id) throw new HttpError(403, 'Only the requested colleague can respond');
  if (r.status !== S.PENDING_COLLEAGUE) throw new HttpError(409, `Request is already ${r.status}`);
  step(r, accept ? S.PENDING_MANAGER : S.DECLINED, user.id);
  await repo.save(r);
  audit('swaps', { event: accept ? 'swap.accepted' : 'swap.declined', id, by: user.id });
  return enrich(r);
}

async function managerDecide(user, id, approve, comment) {
  if (typeof approve !== 'boolean') v.bad('approve must be true or false');
  const note = comment ? v.str(comment, 'comment', { max: 200 }) : undefined;
  const r = await getOr404(id);
  if (r.status !== S.PENDING_MANAGER) throw new HttpError(409, `Request is not waiting for the manager (status ${r.status})`);
  if (approve) await scheduling.reassign(r.shiftId, r.requesterId, r.colleagueId); // re-validates, then updates the schedule
  step(r, approve ? S.APPROVED : S.REJECTED, user.id, note);
  await repo.save(r);
  audit('swaps', { event: approve ? 'swap.approved' : 'swap.rejected', id, by: user.id });
  return enrich(r);
}

async function cancelSwap(user, id) {
  const r = await getOr404(id);
  if (r.requesterId !== user.id) throw new HttpError(403, 'Only the requester can cancel');
  if (!OPEN.includes(r.status)) throw new HttpError(409, `Request is already ${r.status}`);
  step(r, S.CANCELLED, user.id);
  await repo.save(r);
  audit('swaps', { event: 'swap.cancelled', id, by: user.id });
  return enrich(r);
}

// ---------- 3. Flag uncovered shifts (runs on AWS Lambda) ----------
async function uncovered(q = {}) {
  const from = q.from ? v.date(q.from, 'from') : today();
  const to = q.to ? v.date(q.to, 'to') : addDays(from, 6);
  if (to < from) v.bad('to must not be before from');
  if (addDays(from, 62) < to) v.bad('The date range is limited to 62 days');
  const shifts = await scheduling.getShiftsWithAssignments(from, to);
  const { result, source } = await runFunction(config.lambdas.uncovered, { shifts }, findUncovered);
  return { from, to, ...result, source };
}

module.exports = { requestSwap, listSwaps, colleagueRespond, managerDecide, cancelSwap, uncovered };
