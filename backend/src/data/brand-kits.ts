import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BRAND_PREFIX, brandKitSk, clientPk } from '../core/keys.js';
import type { BrandKit } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export async function getBrandKit(clientId: string, kitId: string): Promise<BrandKit | undefined> {
  const response = await documentClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: brandKitSk(kitId) },
    }),
  );
  return response.Item ? withoutKeys<BrandKit>(response.Item) : undefined;
}

export async function saveBrandKit(kit: BrandKit): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: clientPk(kit.clientId), SK: brandKitSk(kit.kitId), ...kit },
    }),
  );
}

export async function listBrandKits(clientId: string): Promise<BrandKit[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': BRAND_PREFIX },
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<BrandKit>(item));
}
