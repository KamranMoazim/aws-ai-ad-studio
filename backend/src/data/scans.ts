import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { clientPk, SCAN_PREFIX, scanSk } from '../core/keys.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export type ScanStatus = 'queued' | 'browsing' | 'processing' | 'analyzing' | 'ready' | 'failed';

export interface Scan {
  scanId: string;
  clientId: string;
  url: string;
  status: ScanStatus;
  attestation: { userId: string; at: string; statement: string };
  prefix: string;
  resultKey?: string;
  pages?: Array<{ url: string; title: string }>;
  error?: string;
  brandKitId?: string;
  createdAt: string;
  updatedAt: string;
}

export const OWNERSHIP_STATEMENT =
  'I own or represent this website and have the right to use its logos, photos and text in ads.';

export async function createScan(scan: Scan): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { PK: clientPk(scan.clientId), SK: scanSk(scan.scanId), ...scan },
    }),
  );
}

export async function getScan(clientId: string, scanId: string): Promise<Scan | undefined> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: clientPk(clientId), SK: scanSk(scanId) } }),
  );
  return response.Item ? withoutKeys<Scan>(response.Item) : undefined;
}

export async function updateScan(
  clientId: string,
  scanId: string,
  fields: Partial<Scan>,
): Promise<void> {
  const names = Object.keys(fields).filter((field) => fields[field as keyof Scan] !== undefined);
  const all = { ...fields, updatedAt: new Date().toISOString() };
  names.push('updatedAt');
  await documentClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: clientPk(clientId), SK: scanSk(scanId) },
      UpdateExpression: `SET ${names.map((field) => `#${field} = :${field}`).join(', ')}`,
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: Object.fromEntries(names.map((field) => [`#${field}`, field])),
      ExpressionAttributeValues: Object.fromEntries(
        names.map((field) => [`:${field}`, all[field as keyof Scan]]),
      ),
    }),
  );
}

export async function listScans(clientId: string, limit = 20): Promise<Scan[]> {
  const response = await documentClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': clientPk(clientId), ':prefix': SCAN_PREFIX },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (response.Items ?? []).map((item) => withoutKeys<Scan>(item));
}
