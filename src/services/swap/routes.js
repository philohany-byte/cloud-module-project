// PRESENTATION/API LAYER - Shift Swap & Coverage service
const router = require('express').Router();
const s = require('./service');
const { wrap } = require('../../shared/errors');
const { requireAuth, requireManager, requireStaff } = require('../../shared/auth');

router.get('/swaps/coverage/uncovered', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.uncovered(req.query))));
router.post('/swaps', requireAuth, requireStaff, wrap(async (req, res) => res.status(201).json(await s.requestSwap(req.user, req.body))));
router.get('/swaps', requireAuth, wrap(async (req, res) => res.json(await s.listSwaps(req.user))));
router.patch('/swaps/:id/colleague-response', requireAuth, requireStaff, wrap(async (req, res) => res.json(await s.colleagueRespond(req.user, req.params.id, req.body.accept))));
router.patch('/swaps/:id/manager-decision', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.managerDecide(req.user, req.params.id, req.body.approve, req.body.comment))));
router.patch('/swaps/:id/cancel', requireAuth, requireStaff, wrap(async (req, res) => res.json(await s.cancelSwap(req.user, req.params.id))));

module.exports = router;
