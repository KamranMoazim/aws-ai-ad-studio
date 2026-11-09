import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ORG_PK, SETTINGS_SK } from '../core/keys.js';
import type { Settings, SettingsInput } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export const defaultSettings = (): Settings => ({
  appName: process.env.APP_NAME || 'AdStudio',
  colors: { primary: '#1f3a5f', accent: '#e4572e', background: '#f7f5f0', text: '#1b1b1b' },
  updatedAt: new Date(0).toISOString(),
});

export async function getSettings(): Promise<Settings> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: ORG_PK, SK: SETTINGS_SK } }),
  );
  return response.Item ? withoutKeys<Settings>(response.Item) : defaultSettings();
}

export async function putSettings(input: SettingsInput): Promise<Settings> {
  const settings: Settings = { ...input, updatedAt: new Date().toISOString() };
  await documentClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: { PK: ORG_PK, SK: SETTINGS_SK, ...settings } }),
  );
  return settings;
}
