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
  templateIds?: string[] | null;
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

export interface Asset {
  assetId: string;
  clientId: string;
  kind: 'logo' | 'photo';
  name: string;
  status: 'pending' | 'ready' | 'failed';
  key?: string;
  width?: number;
  height?: number;
  bytes?: number;
  focalX: number;
  focalY: number;
  facesFound?: number;
  url?: string;
  createdAt: string;
}

export interface BrandKit {
  kitId: string;
  clientId: string;
  name: string;
  colors: Partial<Record<'primary' | 'secondary' | 'accent' | 'text' | 'background', string>>;
  logoLightId?: string;
  logoDarkId?: string;
  photoIds: string[];
  services: Array<{ name: string; description?: string }>;
  offers: Array<{ text: string; sourceUrl?: string }>;
  ctas: string[];
  updatedAt: string;
}

export interface ProjectValues {
  texts: Record<string, string>;
  textOverrides?: Partial<Record<string, Record<string, string>>>;
  images: Record<string, { src: string; focalX: number; focalY: number }>;
  colors: Partial<Record<string, string>>;
}

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
}

export interface ExportFile {
  size: string;
  name: string;
  bytes: number;
  format: 'jpg' | 'png';
  quality?: number;
}

export interface ExportRecord {
  exportId: string;
  status: 'rendering' | 'ready' | 'failed';
  templateVersion: number;
  revision: number;
  files?: ExportFile[];
  zipBytes?: number;
  error?: string;
  createdAt: string;
  finishedAt?: string;
}
