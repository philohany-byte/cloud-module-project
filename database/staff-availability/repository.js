// DATA LAYER - Staff & Availability (DynamoDB tables: Employees, Roles, Availability)
const db = require('../db');
const T = require('../../backend/config').tables;

module.exports = {
  listEmployees: () => db.scan(T.employees),
  getEmployee: (id) => db.get(T.employees, { id }),
  findByEmail: async (email) => (await db.scan(T.employees)).find((e) => e.email === email),
  saveEmployee: (e) => db.put(T.employees, e),
  deleteEmployee: (id) => db.del(T.employees, { id }),

  listRoles: () => db.scan(T.roles),
  getRole: (name) => db.get(T.roles, { name }),
  saveRole: (r) => db.put(T.roles, r),
  deleteRole: (name) => db.del(T.roles, { name }),

  listAvailability: () => db.scan(T.availability),
  getAvailability: (employeeId) => db.get(T.availability, { employeeId }),
  saveAvailability: (a) => db.put(T.availability, a),
  deleteAvailability: (employeeId) => db.del(T.availability, { employeeId }),
};
