import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ASSET_PREFIX, assetSk, clientPk } from '../core/keys.js';
import type { Asset } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export async function getAsset(clientId: string, assetId: string): Promise<Asset | undefined> {
  const response = await documentClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: assetSk(assetId) },
    }),
  );
  return response.Item ? withoutKeys<Asset>(response.Item) : undefined;
}

export async function saveAsset(asset: Asset): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: clientPk(asset.clientId), SK: assetSk(asset.assetId), ...asset },
    }),
  );
}

export async function listAssets(clientId: string): Promise<Asset[]> {
  const assets: Asset[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await documentClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': ASSET_PREFIX },
        ExclusiveStartKey: startKey,
      }),
    );
    assets.push(...(page.Items ?? []).map((item) => withoutKeys<Asset>(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return assets.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
