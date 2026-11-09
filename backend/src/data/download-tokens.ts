import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'node:crypto';
import { downloadTokenPk, META_SK } from '../core/keys.js';
import type { DownloadToken } from '../core/schemas.js';
import { documentClient, TABLE_NAME, ttlAfterDays } from '../core/table.js';
import { withoutKeys } from './items.js';

export const TOKEN_DAYS = 7;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createDownloadToken(
  fields: Omit<DownloadToken, 'expiresAt' | 'createdAt'>,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const record: DownloadToken = {
    ...fields,
    expiresAt: ttlAfterDays(TOKEN_DAYS),
    createdAt: new Date().toISOString(),
  };
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: downloadTokenPk(hashToken(token)), SK: META_SK, ...record },
    }),
  );
  return token;
}

export async function resolveDownloadToken(token: string): Promise<DownloadToken | undefined> {
  if (!TOKEN_PATTERN.test(token)) {
    return undefined;
  }
  const response = await documentClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: downloadTokenPk(hashToken(token)), SK: META_SK },
    }),
  );
  if (!response.Item || Number(response.Item.expiresAt) * 1000 < Date.now()) {
    return undefined;
  }
  const record = {
    ...withoutKeys<DownloadToken>(response.Item),
    expiresAt: Number(response.Item.expiresAt),
  };
  return record;
}
