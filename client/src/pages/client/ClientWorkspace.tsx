import { href, type ClientTab } from '../../app/routes';
import { api } from '../../lib/api';
import type { ClientDetail, Me } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { ClientDetailPage } from '../ClientDetail';
import { AssetsTab } from './AssetsTab';
import { BrandKitsTab } from './BrandKitsTab';
import { PaymentsTab } from './PaymentsTab';
import { ProjectsTab } from './ProjectsTab';

const TABS: Array<[ClientTab, string]> = [
  ['projects', 'Projects'],
  ['brand-kits', 'Brand kits'],
  ['assets', 'Photos and logos'],
  ['payments', 'Payments'],
  ['account', 'Account'],
];

export function ClientWorkspace({
  clientId,
  tab,
  me,
}: {
  clientId: string;
  tab: ClientTab;
  me: Me;
}) {
  const { data, error } = useLoad(
    () => api<ClientDetail>(`/clients/${encodeURIComponent(clientId)}`),
    [clientId],
  );
  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">Loading...</p>;
  }
  return (
    <section>
      <header className="page-header">
        {me.user.type === 'staff' && (
          <a href={href.clients()} className="muted">
            Clients
          </a>
        )}
        <h1>{data.client.name}</h1>
        <span className={`badge ${data.client.status}`}>{data.client.status}</span>
      </header>
      <nav className="page-tabs">
        {TABS.filter(([key]) => key !== 'payments' || data.can.includes('txn:read')).map(
          ([key, label]) => (
            <a
              key={key}
              href={href.client(clientId, key)}
              className={key === tab ? 'active' : undefined}
            >
              {label}
            </a>
          ),
        )}
      </nav>
      {tab === 'projects' && <ProjectsTab clientId={clientId} />}
      {tab === 'brand-kits' && <BrandKitsTab clientId={clientId} />}
      {tab === 'assets' && <AssetsTab clientId={clientId} />}
      {tab === 'payments' && <PaymentsTab clientId={clientId} />}
      {tab === 'account' && <ClientDetailPage clientId={clientId} me={me} />}
    </section>
  );
}
