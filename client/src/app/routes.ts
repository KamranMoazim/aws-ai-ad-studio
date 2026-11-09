import { useEffect, useState } from 'react';

export type Route =
  | { page: 'clients' }
  | { page: 'client'; clientId: string }
  | { page: 'users' }
  | { page: 'templates' }
  | { page: 'template'; templateId: string }
  | { page: 'settings' };

export const href = {
  clients: () => '#/clients',
  client: (clientId: string) => `#/clients/${encodeURIComponent(clientId)}`,
  users: () => '#/users',
  templates: () => '#/templates',
  template: (templateId: string) => `#/templates/${encodeURIComponent(templateId)}`,
  settings: () => '#/settings',
};

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'clients' && parts[1]) {
    return { page: 'client', clientId: parts[1] };
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
