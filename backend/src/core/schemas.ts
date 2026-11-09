import { z } from 'zod';
import { ACTIONS } from '../authz/schema.js';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB color');
const name = z.string().trim().min(1).max(120);

export const USER_TYPES = ['staff', 'client'] as const;
export const SCOPES = ['all', 'assigned', 'own'] as const;

export type UserType = (typeof USER_TYPES)[number];
export type Scope = (typeof SCOPES)[number];

export const brandColorsSchema = z.object({
  primary: hexColor,
  accent: hexColor,
  background: hexColor,
  text: hexColor,
});

export const settingsInputSchema = z.object({
  appName: name,
  colors: brandColorsSchema,
  logoKey: z
    .string()
    .regex(/^branding\/logo-[a-f0-9]{16}\.(png|jpg|webp)$/)
    .optional(),
  supportEmail: z.email().optional(),
  safeZone: z
    .object({
      top: z.number().min(0).max(45),
      bottom: z.number().min(0).max(45),
      sides: z.number().min(0).max(45),
    })
    .optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type Settings = SettingsInput & { updatedAt: string };

export const grantSchema = z.object({
  actions: z.array(z.enum(ACTIONS)).min(1),
  scope: z.enum(SCOPES),
});
export type Grant = z.infer<typeof grantSchema>;

export const roleInputSchema = z
  .object({
    name,
    type: z.enum(USER_TYPES),
    grants: z.array(grantSchema).max(10),
  })
  .refine(
    (role) =>
      role.grants.every((grant) =>
        role.type === 'client' ? grant.scope === 'own' : grant.scope !== 'own',
      ),
    { message: 'client roles use scope "own"; staff roles use "all" or "assigned"' },
  );
export type RoleInput = z.infer<typeof roleInputSchema>;
export type Role = RoleInput & {
  roleId: string;
  builtIn: boolean;
  policyIds: string[];
  updatedAt: string;
};

export const inviteUserSchema = z
  .object({
    email: z.email().transform((email) => email.toLowerCase()),
    name,
    type: z.enum(USER_TYPES),
    roleIds: z.array(z.string().min(1).max(64)).min(1).max(5),
    clientId: z.string().min(1).max(64).optional(),
  })
  .refine((user) => (user.type === 'client') === Boolean(user.clientId), {
    message: 'client users need a clientId; staff users must not have one',
    path: ['clientId'],
  });
export type InviteUser = z.infer<typeof inviteUserSchema>;

export const updateUserSchema = z.object({
  name: name.optional(),
  roleIds: z.array(z.string().min(1).max(64)).min(1).max(5).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export interface User {
  userId: string;
  email: string;
  name: string;
  type: UserType;
  roleIds: string[];
  clientId?: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export const clientInputSchema = z.object({
  name,
  website: z.url().optional(),
  paymentRequired: z.boolean().default(false),
});

export const clientUpdateSchema = z.object({
  templateIds: z.array(z.string().min(1).max(64)).max(200).nullable().optional(),
  name: name.optional(),
  website: z.url().optional(),
  paymentRequired: z.boolean().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export interface Client {
  clientId: string;
  name: string;
  website?: string;
  paymentRequired: boolean;
  status: 'active' | 'archived';
  templateIds?: string[] | null;
  createdAt: string;
}

export const staffAssignmentSchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).max(50),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #RRGGBB color');
const roleColors = z
  .object({
    primary: hex,
    secondary: hex,
    accent: hex,
    text: hex,
    background: hex,
  })
  .partial();
const assetId = z.string().regex(/^[a-f0-9]{16}$/);

export const ASSET_KINDS = ['logo', 'photo'] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const uploadRequestSchema = z.object({
  contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(120),
});

export const assetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
});

export interface Asset {
  assetId: string;
  clientId: string;
  kind: (typeof ASSET_KINDS)[number];
  name: string;
  status: 'pending' | 'ready' | 'failed';
  key?: string;
  contentType?: string;
  width?: number;
  height?: number;
  bytes?: number;
  focalX: number;
  focalY: number;
  facesFound?: number;
  createdAt: string;
  createdBy: string;
}

export const brandKitInputSchema = z.object({
  name,
  colors: roleColors,
  logoLightId: assetId.optional(),
  logoDarkId: assetId.optional(),
  photoIds: z.array(assetId).max(40).default([]),
  services: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(300).optional(),
      }),
    )
    .max(30)
    .default([]),
  offers: z
    .array(z.object({ text: z.string().trim().min(1).max(200), sourceUrl: z.url().optional() }))
    .max(30)
    .default([]),
  ctas: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export type BrandKitInput = z.infer<typeof brandKitInputSchema>;
export type BrandKit = BrandKitInput & {
  kitId: string;
  clientId: string;
  updatedAt: string;
  updatedBy: string;
};

const sizeKey = z.enum([
  '300x250',
  '728x90',
  '300x600',
  '336x280',
  '320x50',
  '1080x1080',
  '1080x1350',
  '1080x1920',
]);
const slotKey = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const slotText = z.string().max(500);

export const projectValuesSchema = z.object({
  texts: z.record(slotKey, slotText),
  textOverrides: z.partialRecord(sizeKey, z.record(slotKey, slotText)).optional(),
  images: z.record(
    slotKey,
    z.object({
      src: z.string().regex(/^assets\/[A-Za-z0-9-]{1,64}\/[a-f0-9]{16}\.(png|jpg|webp)$/),
      focalX: z.number().min(0).max(1),
      focalY: z.number().min(0).max(1),
    }),
  ),
  colors: roleColors,
});
export type ProjectValues = z.infer<typeof projectValuesSchema>;

export const projectCreateSchema = z.object({
  name,
  templateId: z.string().min(1).max(64),
  brandKitId: z.string().min(1).max(64).optional(),
});

export const projectUpdateSchema = z.object({
  revision: z.number().int().min(1),
  name: name.optional(),
  values: projectValuesSchema.optional(),
});

export interface Project {
  projectId: string;
  clientId: string;
  name: string;
  templateId: string;
  templateVersion: number;
  brandKitId?: string;
  values: ProjectValues;
  revision: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface ExportFile {
  size: string;
  name: string;
  key: string;
  bytes: number;
  format: 'jpg' | 'png';
  quality?: number;
}

export interface ExportRecord {
  exportId: string;
  projectId: string;
  clientId: string;
  status: 'awaiting_payment' | 'rendering' | 'ready' | 'failed';
  taskType?: string;
  amountCents?: number;
  currency?: string;
  checkoutUrl?: string;
  revoked?: boolean;
  snapshotKey?: string;
  sizes?: string[];
  templateId: string;
  templateVersion: number;
  revision: number;
  files?: ExportFile[];
  zipKey?: string;
  zipBytes?: number;
  error?: string;
  createdAt: string;
  createdBy: string;
  finishedAt?: string;
}

export const TASK_TYPES = {
  'template-set': 'Template ad set (all sizes)',
  'ai-set': 'AI ad set',
  'single-size': 'Single size',
  're-export': 'Re-export after edits',
  'image-edit': 'AI image edit',
} as const;
export type TaskType = keyof typeof TASK_TYPES;
export const TASK_TYPE_KEYS = Object.keys(TASK_TYPES) as TaskType[];
export const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'] as const;
export const STRIPE_MINIMUM_CENTS = 50;

export const priceInputSchema = z.object({
  amountCents: z.number().int().min(STRIPE_MINIMUM_CENTS).max(1_000_000),
  currency: z.enum(CURRENCIES),
});

export interface Price {
  taskType: TaskType;
  amountCents: number;
  currency: (typeof CURRENCIES)[number];
  updatedAt: string;
}

export interface Transaction {
  txnId: string;
  clientId: string;
  projectId: string;
  exportId: string;
  taskType: TaskType;
  amountCents: number;
  currency: string;
  status: 'paid' | 'exempt' | 'refunded';
  stripeSessionId?: string;
  stripePaymentIntentId?: string;
  receiptUrl?: string;
  createdAt: string;
  refundedAt?: string;
}

export interface DownloadToken {
  exportId: string;
  projectId: string;
  clientId: string;
  expiresAt: number;
  createdBy: string;
  createdAt: string;
}
