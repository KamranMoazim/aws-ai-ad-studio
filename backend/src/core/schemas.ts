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
  createdAt: string;
}

export const staffAssignmentSchema = z.object({
  userIds: z.array(z.string().min(1).max(64)).max(50),
});
