import { loadConfig } from './config';
import type { Branding } from './types';

export async function loadBranding(): Promise<Branding> {
  const { apiUrl } = await loadConfig();
  const response = await fetch(`${apiUrl}/branding`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error('Could not load branding');
  }
  return response.json();
}

export function applyBranding(branding: Branding): void {
  const root = document.documentElement.style;
  root.setProperty('--brand-primary', branding.colors.primary);
  root.setProperty('--brand-accent', branding.colors.accent);
  root.setProperty('--brand-background', branding.colors.background);
  root.setProperty('--brand-text', branding.colors.text);
  document.title = branding.appName;
}
