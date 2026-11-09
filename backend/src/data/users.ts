import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Principal } from '../authz/entities.js';
import {
  CLIENT_PREFIX,
  clientIdFromKey,
  clientPk,
  META_SK,
  memberSk,
  MEMBER_PREFIX,
  STAFF_PREFIX,
  userIndexSk,
  userPk,
  USERS_INDEX,
} from '../core/keys.js';
import type { User } from '../core/schemas.js';
import { documentClient, GSI1, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

const PRINCIPAL_CACHE_MS = 60_000;
const principalCache = new Map<string, { principal: Principal | undefined; loadedAt: number }>();

const userItem = (user: User) => ({
  PK: userPk(user.userId),
  SK: META_SK,
  GSI1PK: USERS_INDEX,
  GSI1SK: userIndexSk(user.type, user.name),
  ...user,
});

export async function getUser(userId: string): Promise<User | undefined> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: userPk(userId), SK: META_SK } }),
  );
  return response.Item ? withoutKeys<User>(response.Item) : undefined;
}

export async function getUsers(userIds: string[]): Promise<User[]> {
  const users: User[] = [];
  for (let start = 0; start < userIds.length; start += 100) {
    const response = await documentClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: userIds.slice(start, start + 100).map((userId) => ({
              PK: userPk(userId),
              SK: META_SK,
            })),
          },
        },
      }),
    );
    users.push(...(response.Responses?.[TABLE_NAME] ?? []).map((item) => withoutKeys<User>(item)));
  }
  return users.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listUsers(): Promise<User[]> {
  const users: User[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': USERS_INDEX },
        ExclusiveStartKey: startKey,
      }),
    );
    users.push(...(page.Items ?? []).map((item) => withoutKeys<User>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return users;
}

export async function createUser(user: User): Promise<void> {
  const items: Record<string, unknown>[] = [userItem(user)];
  if (user.clientId) {
    items.push({
      PK: clientPk(user.clientId),
      SK: memberSk(user.userId),
      GSI1PK: userPk(user.userId),
      GSI1SK: clientPk(user.clientId),
      userId: user.userId,
    });
  }
  await documentClient.send(
    new TransactWriteCommand({
      TransactItems: items.map((Item) => ({
        Put: { TableName: TABLE_NAME, Item, ConditionExpression: 'attribute_not_exists(PK)' },
      })),
    }),
  );
}

export async function saveUser(user: User): Promise<void> {
  await documentClient.send(new PutCommand({ TableName: TABLE_NAME, Item: userItem(user) }));
  principalCache.delete(user.userId);
}

export async function clientMemberIds(clientId: string): Promise<string[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': MEMBER_PREFIX },
    }),
  );
  return (response.Items ?? []).map((item) => item.userId as string);
}

export async function assignedClientIds(userId: string): Promise<string[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1,
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userPk(userId), ':prefix': CLIENT_PREFIX },
    }),
  );
  return (response.Items ?? [])
    .filter((item) => String(item.SK).startsWith(STAFF_PREFIX))
    .map((item) => clientIdFromKey(item.GSI1SK as string));
}

async function fetchPrincipal(userId: string): Promise<Principal | undefined> {
  const user = await getUser(userId);
  if (!user || user.status !== 'active') {
    return undefined;
  }
  return {
    userId,
    type: user.type,
    roleIds: user.roleIds,
    clientId: user.clientId,
    assignedClientIds: user.type === 'staff' ? await assignedClientIds(userId) : [],
    mfaEnabled: user.mfaEnabled === true,
  };
}

export async function loadPrincipal(userId: string): Promise<Principal | undefined> {
  const cached = principalCache.get(userId);
  if (cached && Date.now() - cached.loadedAt < PRINCIPAL_CACHE_MS) {
    return cached.principal;
  }
  const principal = await fetchPrincipal(userId);
  principalCache.set(userId, { principal, loadedAt: Date.now() });
  return principal;
}

export function forgetPrincipal(userId: string): void {
  principalCache.delete(userId);
}
