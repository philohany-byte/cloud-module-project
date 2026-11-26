// CloudWatch Logs audit trail (fire-and-forget: a logging failure never breaks a request).
const { PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { logs } = require('../../database/clients');
const config = require('../config');

function audit(stream, event) {
  logs.send(new PutLogEventsCommand({
    logGroupName: config.logGroup,
    logStreamName: stream,
    logEvents: [{ timestamp: Date.now(), message: JSON.stringify(event) }],
  })).catch((e) => console.warn('[audit] could not write log:', e.message));
}

module.exports = { audit };
