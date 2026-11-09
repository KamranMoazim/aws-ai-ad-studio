export const ORG_PK = 'ORG';
export const SETTINGS_SK = 'SETTINGS';
export const META_SK = 'META';
export const ROLE_PREFIX = 'ROLE#';
export const MEMBER_PREFIX = 'MEMBER#';
export const STAFF_PREFIX = 'STAFF#';
export const CLIENT_PREFIX = 'CLIENT#';
export const USER_PREFIX = 'USER#';

export const USERS_INDEX = 'USERS';
export const CLIENTS_INDEX = 'CLIENTS';

export const roleSk = (roleId: string) => `${ROLE_PREFIX}${roleId}`;
export const userPk = (userId: string) => `${USER_PREFIX}${userId}`;
export const userIndexSk = (type: string, name: string) => `${type}#${name.toLowerCase()}`;
export const clientPk = (clientId: string) => `${CLIENT_PREFIX}${clientId}`;
export const clientIndexSk = (status: string, name: string) => `${status}#${name.toLowerCase()}`;
export const memberSk = (userId: string) => `${MEMBER_PREFIX}${userId}`;
export const staffSk = (userId: string) => `${STAFF_PREFIX}${userId}`;
export const auditPk = (iso: string) => `AUDIT#${iso.slice(0, 7)}`;
export const auditSk = (iso: string, auditId: string) => `${iso}#${auditId}`;
export const userAuditIndexPk = (userId: string) => `${USER_PREFIX}${userId}#AUDIT`;
export const clientIdFromKey = (key: string) => key.slice(CLIENT_PREFIX.length);

export const TEMPLATE_PREFIX = 'TPL#';
export const VERSION_PREFIX = 'V#';
export const templatePk = (templateId: string) => `${TEMPLATE_PREFIX}${templateId}`;
export const templateIndexPk = (status: string) => `TPLS#${status}`;
export const templateIndexSk = (channel: string, name: string) =>
  `${channel}#${name.toLowerCase()}`;
export const versionSk = (version: number) =>
  `${VERSION_PREFIX}${String(version).padStart(6, '0')}`;
export const templateDraftKey = (templateId: string) => `templates/${templateId}/draft.json`;
export const templateVersionKey = (templateId: string, version: number) =>
  `templates/${templateId}/v${version}.json`;

export const ASSET_PREFIX = 'ASSET#';
export const BRAND_PREFIX = 'BRAND#';
export const EXPORT_PREFIX = 'EXPORT#';
export const assetSk = (assetId: string) => `${ASSET_PREFIX}${assetId}`;
export const brandKitSk = (kitId: string) => `${BRAND_PREFIX}${kitId}`;
export const projectPk = (projectId: string) => `PROJ#${projectId}`;
export const clientProjectsIndexPk = (clientId: string) => `${CLIENT_PREFIX}${clientId}#PROJECTS`;
export const exportSk = (iso: string, exportId: string) => `${EXPORT_PREFIX}${iso}#${exportId}`;
export const uploadKey = (clientId: string, assetId: string) => `uploads/${clientId}/${assetId}`;
export const clientAssetKey = (clientId: string, assetId: string, extension: string) =>
  `assets/${clientId}/${assetId}.${extension}`;
export const exportPrefix = (clientId: string, projectId: string, exportId: string) =>
  `exports/${clientId}/${projectId}/${exportId}`;

export const PRICE_PREFIX = 'PRICE#';
export const TXN_PREFIX = 'TXN#';
export const TXNS_INDEX = 'TXNS';
export const priceSk = (taskType: string) => `${PRICE_PREFIX}${taskType}`;
export const txnSk = (iso: string, txnId: string) => `${TXN_PREFIX}${iso}#${txnId}`;
export const downloadTokenPk = (hash: string) => `DL#${hash}`;
export const stripeEventPk = (eventId: string) => `STRIPE#${eventId}`;

export const SCAN_PREFIX = 'SCAN#';
export const scanSk = (scanId: string) => `${SCAN_PREFIX}${scanId}`;
export const scanFolder = (clientId: string, scanId: string) => `scans/${clientId}/${scanId}`;
