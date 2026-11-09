import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { newId } from '../core/ids.js';
import {
  clientIndexSk,
  CLIENTS_INDEX,
  clientPk,
  META_SK,
  STAFF_PREFIX,
  staffSk,
  userPk,
} from '../core/keys.js';
import type { Client } from '../core/schemas.js';
import { documentClient, GSI1, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

const clientItem = (client: Client) => ({
  PK: clientPk(client.clientId),
  SK: META_SK,
  GSI1PK: CLIENTS_INDEX,
  GSI1SK: clientIndexSk(client.status, client.name),
  ...client,
});

export async function createClient(input: Omit<Client, 'clientId' | 'status' | 'createdAt'>) {
  const client: Client = {
    ...input,
    clientId: newId(),
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: clientItem(client),
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  return client;
}

export async function getClient(clientId: string): Promise<Client | undefined> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: clientPk(clientId), SK: META_SK } }),
  );
  return response.Item ? withoutKeys<Client>(response.Item) : undefined;
}

export async function saveClient(client: Client): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: clientItem(client),
      ConditionExpression: 'attribute_exists(PK)',
    }),
  );
}

export async function listAllClients(): Promise<Client[]> {
  const clients: Client[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': CLIENTS_INDEX },
        ExclusiveStartKey: startKey,
      }),
    );
    clients.push(...(page.Items ?? []).map((item) => withoutKeys<Client>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return clients;
}

export async function clientStaffIds(clientId: string): Promise<string[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': STAFF_PREFIX },
    }),
  );
  return (response.Items ?? []).map((item) => item.userId as string);
}

export async function setClientStaff(clientId: string, userIds: string[]): Promise<void> {
  const current = new Set(await clientStaffIds(clientId));
  const wanted = new Set(userIds);
  for (const userId of wanted) {
    if (!current.has(userId)) {
      await documentClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: {
            PK: clientPk(clientId),
            SK: staffSk(userId),
            GSI1PK: userPk(userId),
            GSI1SK: clientPk(clientId),
            userId,
          },
        }),
      );
    }
  }
  for (const userId of current) {
    if (!wanted.has(userId)) {
      await documentClient.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { PK: clientPk(clientId), SK: staffSk(userId) },
        }),
      );
    }
  }
}
