export type UserType = 'staff' | 'client';

export interface BrandColors {
  primary: string;
  accent: string;
  background: string;
  text: string;
}

export interface Branding {
  appName: string;
  colors: BrandColors;
  logoUrl?: string;
}

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

export interface Me {
  user: User;
  can: string[];
}

export interface Role {
  roleId: string;
  name: string;
  type: UserType;
  builtIn: boolean;
}

export interface Client {
  clientId: string;
  name: string;
  website?: string;
  paymentRequired: boolean;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface ClientDetail {
  client: Client;
  can: string[];
  staff?: User[];
  members?: User[];
}

export interface Settings extends Branding {
  logoKey?: string;
  supportEmail?: string;
}

export interface TemplateMeta {
  templateId: string;
  name: string;
  channel: 'display' | 'meta' | 'both';
  tags: string[];
  status: 'draft' | 'published';
  latestVersion: number;
  revision: number;
  publishedRevision?: number;
  updatedAt: string;
}
