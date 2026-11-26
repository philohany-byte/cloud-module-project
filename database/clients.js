const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { S3Client } = require('@aws-sdk/client-s3');
const { LambdaClient } = require('@aws-sdk/client-lambda');
const { IAMClient } = require('@aws-sdk/client-iam');
const { CloudWatchLogsClient } = require('@aws-sdk/client-cloudwatch-logs');
const { aws } = require('../backend/config');

const base = {
  region: aws.region,
  endpoint: aws.endpoint,
  credentials: { accessKeyId: aws.accessKeyId, secretAccessKey: aws.secretAccessKey },
};

module.exports = {
  dynamo: new DynamoDBClient(base),
  ddb: DynamoDBDocumentClient.from(new DynamoDBClient(base), {
    marshallOptions: { removeUndefinedValues: true },
  }),
  s3: new S3Client({ ...base, forcePathStyle: true }),
  lambda: new LambdaClient(base),
  iam: new IAMClient(base),
  logs: new CloudWatchLogsClient(base),
};
