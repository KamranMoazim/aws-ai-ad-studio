import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { clientPk, ORG_PK, PRICE_PREFIX, priceSk } from '../core/keys.js';
import type { Price, TaskType } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

async function pricesIn(partitionKey: string): Promise<Price[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': partitionKey, ':prefix': PRICE_PREFIX },
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<Price>(item));
}

export const listDefaultPrices = () => pricesIn(ORG_PK);
export const listClientPrices = (clientId: string) => pricesIn(clientPk(clientId));

export async function putPrice(price: Price, clientId?: string): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: clientId ? clientPk(clientId) : ORG_PK, SK: priceSk(price.taskType), ...price },
    }),
  );
}

export async function deletePrice(taskType: TaskType, clientId?: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientId ? clientPk(clientId) : ORG_PK, SK: priceSk(taskType) },
    }),
  );
}

export async function effectivePrice(
  clientId: string,
  taskType: TaskType,
): Promise<Price | undefined> {
  for (const partitionKey of [clientPk(clientId), ORG_PK]) {
    const response = await documentClient.send(
      new GetCommand({ TableName: TABLE_NAME, Key: { PK: partitionKey, SK: priceSk(taskType) } }),
    );
    if (response.Item) {
      return withoutKeys<Price>(response.Item);
    }
  }
  return undefined;
}
