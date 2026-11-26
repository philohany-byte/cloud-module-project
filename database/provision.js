// Creates the (emulated) AWS resources and seeds first data. Safe to run repeatedly.
//   node database/provision.js          -> resources + default roles + the manager and staff login accounts
//   node database/provision.js --demo   -> also 4 extra demo staff (needed to try shift swaps)
const path = require('path');
const AdmZip = require('adm-zip');
const { CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');
const { CreateBucketCommand } = require('@aws-sdk/client-s3');
const { CreateLogGroupCommand, CreateLogStreamCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { CreateRoleCommand, GetRoleCommand, AttachRolePolicyCommand } = require('@aws-sdk/client-iam');
const { CreateFunctionCommand, UpdateFunctionCodeCommand } = require('@aws-sdk/client-lambda');
const { dynamo, s3, logs, iam, lambda } = require('./clients');
const config = require('../backend/config');

const T = config.tables;
const TABLES = [
  [T.employees, [['id', 'HASH']]],
  [T.roles, [['name', 'HASH']]],
  [T.availability, [['employeeId', 'HASH']]],
  [T.shifts, [['id', 'HASH']]],
  [T.assignments, [['shiftId', 'HASH'], ['employeeId', 'RANGE']]],
  [T.swaps, [['id', 'HASH']]],
];
const ignore = (...names) => (e) => { if (!names.includes(e.name)) throw e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForAws() {
  for (let i = 1; i <= 30; i++) {
    try { await dynamo.send(new ListTablesCommand({})); return; } catch { console.log(`Waiting for AWS emulator (${i}/30)...`); await sleep(2000); }
  }
  throw new Error(`Cannot reach the AWS emulator at ${config.aws.endpoint}. Is Floci running?`);
}

async function createTables() {
  for (const [name, keys] of TABLES) {
    await dynamo.send(new CreateTableCommand({
      TableName: name,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: keys.map(([n]) => ({ AttributeName: n, AttributeType: 'S' })),
      KeySchema: keys.map(([n, t]) => ({ AttributeName: n, KeyType: t })),
    })).then(() => console.log('DynamoDB table created:', name)).catch(ignore('ResourceInUseException'));
  }
}

async function createStorageAndLogs() {
  await s3.send(new CreateBucketCommand({ Bucket: config.bucket })).then(() => console.log('S3 bucket created:', config.bucket)).catch(ignore('BucketAlreadyOwnedByYou', 'BucketAlreadyExists'));
  await logs.send(new CreateLogGroupCommand({ logGroupName: config.logGroup })).catch(ignore('ResourceAlreadyExistsException'));
  for (const s of config.logStreams) {
    await logs.send(new CreateLogStreamCommand({ logGroupName: config.logGroup, logStreamName: s })).catch(ignore('ResourceAlreadyExistsException'));
  }
  console.log('CloudWatch log group ready:', config.logGroup);
}

async function createLambdaRole() {
  const trust = JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] });
  let arn;
  try {
    arn = (await iam.send(new CreateRoleCommand({ RoleName: config.lambdaRole, AssumeRolePolicyDocument: trust }))).Role.Arn;
    console.log('IAM role created:', arn);
  } catch (e) {
    if (e.name !== 'EntityAlreadyExistsException') throw e;
    arn = (await iam.send(new GetRoleCommand({ RoleName: config.lambdaRole }))).Role.Arn;
  }
  await iam.send(new AttachRolePolicyCommand({ RoleName: config.lambdaRole, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' })).catch((e) => console.warn('Policy attach skipped:', e.message));
  return arn;
}

async function deployLambdas(roleArn) {
  for (const name of Object.values(config.lambdas)) {
    const zip = new AdmZip();
    zip.addLocalFolder(path.join(__dirname, '..', 'backend', 'services', LAMBDA_DIRS[name], 'lambda'));
    const ZipFile = zip.toBuffer();
    try {
      await lambda.send(new CreateFunctionCommand({ FunctionName: name, Runtime: 'nodejs20.x', Role: roleArn, Handler: 'index.handler', Timeout: 10, Code: { ZipFile } }));
      console.log('Lambda deployed:', name);
    } catch (e) {
      if (e.name !== 'ResourceConflictException') throw e;
      await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile }));
      console.log('Lambda updated:', name);
    }
  }
}

// Each Lambda function lives inside the service that owns it.
const LAMBDA_DIRS = { 'coverage-analysis': 'staff-availability', 'uncovered-shifts': 'shift-swap' };
const PASSWORD = process.env.SEED_PASSWORD || '12345';
const MAIN_ACCOUNTS = [
  { name: 'Felopateer Hany', email: 'felomanager@gmail.com', userType: 'manager' },
  { name: 'Ahmed Hassan', email: 'felostaff@gmail.com', userType: 'staff', roles: ['Cashier'] },
];
const DEMO_STAFF = [
  { name: 'Ali Mohamed', email: 'ali@example.com', roles: ['Cashier'] },
  { name: 'Sara Ibrahim', email: 'sara@example.com', roles: ['Cashier'] },
  { name: 'Mona Khaled', email: 'mona@example.com', roles: ['Supervisor'] },
  { name: 'Omar Youssef', email: 'omar@example.com', roles: ['Cashier', 'Supervisor'] },
];
const LEGACY = ['manager@example.com', 'alice@example.com', 'bob@example.com', 'cara@example.com'];

async function seed(demo) {
  const staff = require('../backend/services/staff-availability/service');
  if ((await staff.listRoles()).length === 0) {
    await staff.createRole({ name: 'Cashier', minHeadcount: 1 });
    await staff.createRole({ name: 'Supervisor', minHeadcount: 1 });
    console.log('Default roles created: Cashier, Supervisor');
  }
  let existing = await staff.listEmployees();
  for (const e of existing.filter((x) => LEGACY.includes(x.email))) { // accounts from the first version
    await staff.deleteEmployee(e.id, 'system');
    console.log('Old demo account removed:', e.email);
  }
  existing = await staff.listEmployees();
  for (const acc of [...MAIN_ACCOUNTS, ...(demo ? DEMO_STAFF.map((d) => ({ ...d, userType: 'staff' })) : [])]) {
    if (existing.some((e) => e.email === acc.email)) continue;
    const e = await staff.createEmployee({ ...acc, password: PASSWORD });
    if (acc.userType === 'staff') await staff.setAvailability(e.id, [1, 2, 3, 4, 5].map((day) => ({ day, start: '08:00', end: '18:00' })));
    console.log(`Account created: ${acc.email} (${acc.userType}, ${acc.name})`);
  }
}

async function main() {
  await waitForAws();
  await createTables();
  await createStorageAndLogs();
  try { await deployLambdas(await createLambdaRole()); } catch (e) { console.warn(`Lambda deployment failed (${e.message}). The app will use its local fallback; set USE_LAMBDA=false to silence this.`); }
  await seed(process.argv.includes('--demo'));
  console.log('Provisioning finished.');
}
main().catch((e) => { console.error(e); process.exit(1); });
