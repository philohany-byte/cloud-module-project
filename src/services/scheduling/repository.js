// DATA LAYER - Shift Scheduling (DynamoDB tables: Shifts, Assignments)
// Assignments: partition key = shiftId, sort key = employeeId (one row per person per shift).
const db = require('../../aws/db');
const T = require('../../config').tables;

module.exports = {
  listShifts: () => db.scan(T.shifts),
  getShift: (id) => db.get(T.shifts, { id }),
  saveShift: (s) => db.put(T.shifts, s),

  allAssignments: () => db.scan(T.assignments),
  assignmentsByShift: (shiftId) => db.query(T.assignments, 'shiftId', shiftId),
  getAssignment: (shiftId, employeeId) => db.get(T.assignments, { shiftId, employeeId }),
  saveAssignment: (a) => db.put(T.assignments, a),
  deleteAssignment: (shiftId, employeeId) => db.del(T.assignments, { shiftId, employeeId }),
};
