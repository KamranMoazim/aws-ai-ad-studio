import type { Content, SafeZone, SizeKey, Template } from '../../../shared/src/index.js';

export interface ExportSnapshot {
  exportId: string;
  projectId: string;
  clientId: string;
  projectName: string;
  createdAt: string;
  template: Template;
  content: Content;
  safeZone: SafeZone;
  sizes: SizeKey[];
}

export interface ExportInput {
  exportId: string;
  projectId: string;
  clientId: string;
  createdAt: string;
  snapshotKey: string;
  sizes: SizeKey[];
}

export const snapshotKeyFor = (prefix: string) => `${prefix}/snapshot.json`;

export function fileBase(projectName: string): string {
  return (
    projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'ad'
  );
}
