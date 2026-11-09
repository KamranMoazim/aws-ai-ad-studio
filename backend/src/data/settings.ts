import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DEFAULT_SAFE_ZONE, type SafeZone } from '../../../shared/src/index.js';
import { ORG_PK, SETTINGS_SK } from '../core/keys.js';
import type { Settings, SettingsInput } from '../core/schemas.js';
import { documentClient, TABLE_NAME } from '../core/table.js';
import { withoutKeys } from './items.js';

export interface Limits {
  scansPerDay: number;
  generationsPerDay: number;
  imageEditsPerDay: number;
}

export const DEFAULT_LIMITS: Limits = {
  scansPerDay: 10,
  generationsPerDay: 20,
  imageEditsPerDay: 20,
};

export const defaultSettings = (): Settings => ({
  appName: process.env.APP_NAME || 'AdStudio',
  colors: { primary: '#1f3a5f', accent: '#e4572e', background: '#f7f5f0', text: '#1b1b1b' },
  safeZone: DEFAULT_SAFE_ZONE,
  limits: DEFAULT_LIMITS,
  requireStaffMfa: true,
  updatedAt: new Date(0).toISOString(),
});

export const limitsOf = (settings: Settings): Limits => ({
  ...DEFAULT_LIMITS,
  ...(settings.limits ?? {}),
});
export const staffMfaRequired = (settings: Settings) => settings.requireStaffMfa !== false;

export async function getSettings(): Promise<Settings> {
  const response = await documentClient.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { PK: ORG_PK, SK: SETTINGS_SK } }),
  );
  return response.Item ? withoutKeys<Settings>(response.Item) : defaultSettings();
}

export const safeZoneOf = (settings: Settings): SafeZone => settings.safeZone ?? DEFAULT_SAFE_ZONE;

export async function putSettings(input: SettingsInput): Promise<Settings> {
  const settings: Settings = { ...input, updatedAt: new Date().toISOString() };
  await documentClient.send(
    new PutCommand({ TableName: TABLE_NAME, Item: { PK: ORG_PK, SK: SETTINGS_SK, ...settings } }),
  );
  return settings;
}

const SETTINGS_CACHE_MS = 60_000;
let cachedSettings: { settings: Settings; at: number } | undefined;

export async function cachedSettingsValue(): Promise<Settings> {
  if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_CACHE_MS) {
    return cachedSettings.settings;
  }
  const settings = await getSettings();
  cachedSettings = { settings, at: Date.now() };
  return settings;
}
