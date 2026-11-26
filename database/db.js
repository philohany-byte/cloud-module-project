// Thin DynamoDB helpers shared by the three services' repositories.
const { PutCommand, GetCommand, DeleteCommand, ScanCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('./clients');

exports.put = (TableName, Item) => ddb.send(new PutCommand({ TableName, Item }));
exports.get = async (TableName, Key) => (await ddb.send(new GetCommand({ TableName, Key }))).Item;
exports.del = (TableName, Key) => ddb.send(new DeleteCommand({ TableName, Key }));

// Scan returns the whole table (paged). Fine for the small data volume of this project.
exports.scan = async (TableName) => {
  const items = [];
  let ExclusiveStartKey;
  do {
    const r = await ddb.send(new ScanCommand({ TableName, ExclusiveStartKey }));
    items.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
};

exports.query = async (TableName, pkName, pkValue) => {
  const r = await ddb.send(new QueryCommand({
    TableName,
    KeyConditionExpression: '#k = :v',
    ExpressionAttributeNames: { '#k': pkName },
    ExpressionAttributeValues: { ':v': pkValue },
  }));
  return r.Items || [];
};
