const { analyse } = require('./logic');
exports.handler = async (event) => analyse(event);
