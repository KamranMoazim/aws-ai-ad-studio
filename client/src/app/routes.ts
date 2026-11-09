import { useEffect, useState } from 'react';

export type ClientTab = 'projects' | 'brand-kits' | 'assets' | 'payments' | 'account';
const CLIENT_TABS: ClientTab[] = ['projects', 'brand-kits', 'assets', 'payments', 'account'];

export type Route =
  | { page: 'clients' }
  | { page: 'client'; clientId: string; tab: ClientTab }
  | { page: 'project'; projectId: string }
  | { page: 'users' }
  | { page: 'templates' }
  | { page: 'pricing' }
  | { page: 'transactions' }
  | { page: 'template'; templateId: string }
  | { page: 'settings' };

export const href = {
  clients: () => '#/clients',
  client: (clientId: string, tab: ClientTab = 'projects') =>
    `#/clients/${encodeURIComponent(clientId)}${tab === 'projects' ? '' : `/${tab}`}`,
  project: (projectId: string) => `#/projects/${encodeURIComponent(projectId)}`,
  users: () => '#/users',
  templates: () => '#/templates',
  pricing: () => '#/pricing',
  transactions: () => '#/transactions',
  template: (templateId: string) => `#/templates/${encodeURIComponent(templateId)}`,
  settings: () => '#/settings',
};

function parse(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  if (parts[0] === 'clients' && parts[1]) {
    const tab = CLIENT_TABS.find((item) => item === parts[2]) ?? 'projects';
    return { page: 'client', clientId: parts[1], tab };
  }
  if (parts[0] === 'projects' && parts[1]) {
    return { page: 'project', projectId: parts[1] };
  }
  if (parts[0] === 'pricing') {
    return { page: 'pricing' };
  }
  if (parts[0] === 'transactions') {
    return { page: 'transactions' };
  }
  if (parts[0] === 'templates') {
    return parts[1] ? { page: 'template', templateId: parts[1] } : { page: 'templates' };
  }
  if (parts[0] === 'users') {
    return { page: 'users' };
  }
  if (parts[0] === 'settings') {
    return { page: 'settings' };
  }
  return { page: 'clients' };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function hashQuery(name: string): string | undefined {
  const query = window.location.hash.split('?')[1];
  return query ? (new URLSearchParams(query).get(name) ?? undefined) : undefined;
}
