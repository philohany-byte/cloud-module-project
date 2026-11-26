const { findUncovered } = require('./logic');
exports.handler = async (event) => findUncovered(event);
