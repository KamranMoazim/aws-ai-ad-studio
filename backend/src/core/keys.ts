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
