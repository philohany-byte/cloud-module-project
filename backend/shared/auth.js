// Authentication middleware (owned by the Staff & Availability service, used by all routes).
const jwt = require('jsonwebtoken');
const config = require('../config');
const { HttpError } = require('./errors');

const sign = (u) => jwt.sign({ id: u.id, userType: u.userType, name: u.name }, config.jwtSecret, { expiresIn: '8h' });

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { return next(new HttpError(401, 'Invalid or expired token')); }
  try {
    // Load the account again so deleted users lose access immediately and the user type is always current.
    const e = await require('../services/staff-availability/service').getEmployee(payload.id);
    if (!e) return next(new HttpError(401, 'This account no longer exists'));
    req.user = { id: e.id, userType: e.userType, name: e.name };
    return next();
  } catch (err) { return next(err); }
}
const requireManager = (req, res, next) =>
  (req.user.userType === 'manager' ? next() : next(new HttpError(403, 'Manager access required')));
const requireStaff = (req, res, next) =>
  (req.user.userType === 'staff' ? next() : next(new HttpError(403, 'Staff access required')));

module.exports = { sign, requireAuth, requireManager, requireStaff };
