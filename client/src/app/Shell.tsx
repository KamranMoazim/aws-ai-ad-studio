import type { ReactNode } from 'react';
import type { Branding, Me } from '../lib/types';
import { Brand } from './Brand';
import { href, type Route } from './routes';

interface ShellProps {
  branding: Branding;
  me: Me;
  route: Route;
  onSignOut: () => void;
  children: ReactNode;
}

export function Shell({ branding, me, route, onSignOut, children }: ShellProps) {
  const links = [
    {
      label: 'Clients',
      to: href.clients(),
      active: route.page === 'clients' || route.page === 'client',
      show: true,
    },
    {
      label: 'Templates',
      to: href.templates(),
      active: route.page === 'templates' || route.page === 'template',
      show: me.can.includes('template:read'),
    },
    {
      label: 'Users',
      to: href.users(),
      active: route.page === 'users',
      show: me.can.includes('user:manage'),
    },
    {
      label: 'Settings',
      to: href.settings(),
      active: route.page === 'settings',
      show: me.can.includes('settings:manage'),
    },
  ];
  return (
    <div className="shell">
      <header className="shell-bar">
        <a href={href.clients()} className="shell-home">
          <Brand branding={branding} />
        </a>
        <nav className="shell-nav">
          {links
            .filter((link) => link.show)
            .map((link) => (
              <a key={link.label} href={link.to} className={link.active ? 'active' : undefined}>
                {link.label}
              </a>
            ))}
        </nav>
        <div className="shell-user">
          <span title={me.user.email}>{me.user.name}</span>
          <button className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className={route.page === 'template' ? 'shell-main wide' : 'shell-main'}>
        {children}
      </main>
    </div>
  );
}
