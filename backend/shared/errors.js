class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}
module.exports = { HttpError, wrap, errorHandler };
