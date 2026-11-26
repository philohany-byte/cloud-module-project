// DATA LAYER - Shift Swap & Coverage (DynamoDB table: SwapRequests)
const db = require('../../aws/db');
const T = require('../../config').tables;

module.exports = {
  list: () => db.scan(T.swaps),
  get: (id) => db.get(T.swaps, { id }),
  save: (r) => db.put(T.swaps, r),
};
