// PRESENTATION/API LAYER - Staff & Availability service
const router = require('express').Router();
const s = require('./service');
const { wrap } = require('../../shared/errors');
const { requireAuth, requireManager, requireStaff } = require('../../shared/auth');

router.post('/auth/login', wrap(async (req, res) => res.json(await s.login(req.body))));
router.get('/auth/me', requireAuth, wrap(async (req, res) => res.json(await s.getEmployeeOr404(req.user.id))));

router.get('/staff/employees', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.listEmployees())));
router.post('/staff/employees', requireAuth, requireManager, wrap(async (req, res) => res.status(201).json(await s.createEmployee(req.body))));
router.get('/staff/employees/:id', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.getEmployeeOr404(req.params.id))));
router.put('/staff/employees/:id', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.updateEmployee(req.params.id, req.body))));
router.delete('/staff/employees/:id', requireAuth, requireManager, wrap(async (req, res) => { await s.deleteEmployee(req.params.id, req.user.id); res.status(204).end(); }));
router.get('/staff/colleagues', requireAuth, requireStaff, wrap(async (req, res) => res.json((await s.listStaff()).filter((e) => e.id !== req.user.id))));

router.get('/staff/roles', requireAuth, wrap(async (req, res) => res.json(await s.listRoles())));
router.post('/staff/roles', requireAuth, requireManager, wrap(async (req, res) => res.status(201).json(await s.createRole(req.body))));
router.put('/staff/roles/:name', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.updateRole(req.params.name, req.body))));
router.delete('/staff/roles/:name', requireAuth, requireManager, wrap(async (req, res) => { await s.deleteRole(req.params.name); res.status(204).end(); }));

router.get('/staff/availability/me', requireAuth, requireStaff, wrap(async (req, res) => res.json(await s.getAvailability(req.user.id))));
router.put('/staff/availability/me', requireAuth, requireStaff, wrap(async (req, res) => res.json(await s.setAvailability(req.user.id, req.body.slots))));
router.get('/staff/availability', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.listAllAvailability())));
router.get('/staff/coverage', requireAuth, requireManager, wrap(async (req, res) => res.json(await s.coverage(req.query))));

module.exports = router;
