import { useEffect, useState } from 'react';

export type Route =
  | { page: 'clients' }
  | { page: 'client'; clientId: string }
  | { page: 'users' }
  | { page: 'settings' };

export const href = {
  clients: () => '#/clients',
  client: (clientId: string) => `#/clients/${encodeURIComponent(clientId)}`,
  users: () => '#/users',
  settings: () => '#/settings',
};

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'clients' && parts[1]) {
    return { page: 'client', clientId: parts[1] };
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
