import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText } from '../lib/api';
import { isSignedIn, signOut } from '../lib/auth';
import { applyBranding, loadBranding } from '../lib/branding';
import type { Branding, Me } from '../lib/types';
import { ClientDetailPage } from '../pages/ClientDetail';
import { ClientsPage } from '../pages/Clients';
import { SettingsPage } from '../pages/Settings';
import { SignIn } from '../pages/SignIn';
import { TemplatesPage } from '../pages/Templates';
import { UsersPage } from '../pages/Users';
import { Brand } from './Brand';
import { useHashRoute } from './routes';
import { Shell } from './Shell';

const TemplateBuilder = lazy(() =>
  import('../pages/builder/Builder').then((module) => ({ default: module.TemplateBuilder })),
);

type State =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'no-access'; message: string }
  | { status: 'ready'; me: Me };

export function App() {
  const [branding, setBranding] = useState<Branding | undefined>();
  const [state, setState] = useState<State>({ status: 'loading' });
  const route = useHashRoute();

  const refreshBranding = useCallback(() => {
    loadBranding()
      .then((next) => {
        applyBranding(next);
        setBranding(next);
      })
      .catch(() =>
        setBranding({
          appName: '',
          colors: { primary: '#1f3a5f', accent: '#e4572e', background: '#f7f5f0', text: '#1b1b1b' },
        }),
      );
  }, []);

  const loadMe = useCallback(async () => {
    if (!(await isSignedIn())) {
      setState({ status: 'signed-out' });
      return;
    }
    try {
      setState({ status: 'ready', me: await api<Me>('/me') });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await signOut();
        setState({ status: 'signed-out' });
      } else {
        setState({ status: 'no-access', message: errorText(error) });
      }
    }
  }, []);

  useEffect(() => {
    refreshBranding();
    loadMe();
  }, [refreshBranding, loadMe]);

  const leave = async () => {
    await signOut();
    window.location.hash = '';
    setState({ status: 'signed-out' });
  };

  if (!branding || state.status === 'loading') {
    return <div className="splash" aria-busy="true" />;
  }
  if (state.status === 'signed-out') {
    return <SignIn branding={branding} onSignedIn={loadMe} />;
  }
  if (state.status === 'no-access') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <Brand branding={branding} />
          <p className="error">{state.message}</p>
          <button className="button" onClick={leave}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const { me } = state;
  return (
    <Shell branding={branding} me={me} route={route} onSignOut={leave}>
      {route.page === 'clients' && <ClientsPage me={me} />}
      {route.page === 'client' && <ClientDetailPage clientId={route.clientId} me={me} />}
      {route.page === 'users' && <UsersPage me={me} />}
      {route.page === 'templates' && <TemplatesPage me={me} />}
      {route.page === 'template' && (
        <Suspense fallback={<p className="muted">Loading builder...</p>}>
          <TemplateBuilder
            key={route.templateId}
            templateId={route.templateId}
            canPublish={me.can.includes('template:create')}
          />
        </Suspense>
      )}
      {route.page === 'settings' && <SettingsPage onSaved={refreshBranding} />}
    </Shell>
  );
}
