const { HttpError } = require('./errors');

const bad = (message, details) => { throw new HttpError(400, message, details); };

const str = (v, name, { min = 1, max = 100 } = {}) => {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) {
    bad(`${name} must be text of ${min}-${max} characters`);
  }
  return v.trim();
};
const email = (v) => {
  const s = str(v, 'email', { max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('email is not valid');
  return s;
};
const time = (v, name) => {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) bad(`${name} must be a time in HH:MM (24h) format`);
  return v;
};
const date = (v, name = 'date') => {
  const ok = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
    && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!ok) bad(`${name} must be a valid date in YYYY-MM-DD format`);
  return v;
};
const int = (v, name, min, max) => {
  if (!Number.isInteger(v) || v < min || v > max) bad(`${name} must be a whole number between ${min} and ${max}`);
  return v;
};

module.exports = { bad, str, email, time, date, int };
