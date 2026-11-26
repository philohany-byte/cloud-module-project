// PRESENTATION/API LAYER - Shift Scheduling service
const router = require('express').Router();
const s = require('./service');
const { wrap } = require('../../shared/errors');
const { requireAuth, requireManager, requireStaff } = require('../../shared/auth');

router.post('/shifts', requireAuth, requireManager, wrap(async (req, res) => res.status(201).json(await s.createShift(req.body, req.user))));
router.put('/shifts/:id', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.updateShift(req.params.id, req.body, req.user))));
router.patch('/shifts/:id/cancel', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.cancelShift(req.params.id, req.user))));
router.post('/shifts/:id/assignments', requireAuth, requireManager, wrap(async (req, res) => res.status(201).json(await s.assign(req.params.id, req.body, req.user))));
router.delete('/shifts/:id/assignments/:employeeId', requireAuth, requireManager, wrap(async (req, res) => { await s.unassign(req.params.id, req.params.employeeId, req.user); res.status(204).end(); }));

router.get('/schedule/week', requireAuth, wrap(async (req, res) => res.json(await s.weekSchedule(req.query.weekStart, req.user))));
router.get('/schedule/calendar.ics', requireAuth, requireStaff, wrap(async (req, res) => {
  const { content } = await s.exportCalendar(req.user);
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="my-shifts.ics"' }).send(content);
}));

module.exports = router;
