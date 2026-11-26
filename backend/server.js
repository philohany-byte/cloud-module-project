const path = require('path');
const express = require('express');
const config = require('./config');
const { errorHandler } = require('./shared/errors');

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api', require('./services/staff-availability/routes'));
app.use('/api', require('./services/shift-scheduling/routes'));
app.use('/api', require('./services/shift-swap/routes'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));

app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Staff Shift Scheduler running on http://localhost:${config.port}`));
}
module.exports = app;
