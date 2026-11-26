// Runs a business function on AWS Lambda (Floci). If Lambda is unavailable the same
// logic runs locally so the app keeps working; the response says which one was used.
const { InvokeCommand } = require('@aws-sdk/client-lambda');
const { lambda } = require('../../database/clients');
const config = require('../config');

async function runFunction(name, payload, localFn) {
  if (config.useLambda) {
    try {
      const out = await lambda.send(new InvokeCommand({
        FunctionName: name,
        Payload: Buffer.from(JSON.stringify(payload)),
      }));
      const text = Buffer.from(out.Payload).toString('utf8');
      if (out.FunctionError) throw new Error(text);
      return { result: JSON.parse(text), source: 'lambda' };
    } catch (err) {
      console.warn(`[lambda] ${name} failed (${err.message}); using local fallback`);
    }
  }
  return { result: localFn(payload), source: 'local' };
}

module.exports = { runFunction };
