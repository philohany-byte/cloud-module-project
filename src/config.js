module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  useLambda: process.env.USE_LAMBDA !== 'false',
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL || 'http://localhost:4566',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
  tables: {
    employees: 'Employees',
    roles: 'Roles',
    availability: 'Availability',
    shifts: 'Shifts',
    assignments: 'Assignments',
    swaps: 'SwapRequests',
  },
  bucket: 'shift-calendar-exports',
  logGroup: '/shift-scheduler/events',
  logStreams: ['scheduling', 'swaps'],
  lambdas: { coverage: 'coverage-analysis', uncovered: 'uncovered-shifts' },
  lambdaRole: 'shift-scheduler-lambda-role',
};
