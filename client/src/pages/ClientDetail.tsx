import { useState, type FormEvent } from 'react';
import { href } from '../app/routes';
import { InviteForm } from '../components/InviteForm';
import { api, errorText } from '../lib/api';
import type { Client, ClientDetail, Me, Role, User } from '../lib/types';
import { useLoad } from '../lib/useLoad';

interface DetailData {
  detail: ClientDetail;
  roles: Role[];
  staffOptions?: User[];
}

async function loadDetail(clientId: string): Promise<DetailData> {
  const detail = await api<ClientDetail>(`/clients/${encodeURIComponent(clientId)}`);
  const [roles, staffOptions] = await Promise.all([
    detail.can.includes('user:invite') ? api<{ roles: Role[] }>('/roles') : undefined,
    detail.can.includes('client:assign-staff')
      ? api<{ users: User[] }>(`/clients/${encodeURIComponent(clientId)}/staff-options`)
      : undefined,
  ]);
  return { detail, roles: roles?.roles ?? [], staffOptions: staffOptions?.users };
}

export function ClientDetailPage({ clientId }: { clientId: string; me: Me }) {
  const { data, error, reload } = useLoad(() => loadDetail(clientId), [clientId]);
  const [actionError, setActionError] = useState<string | undefined>();

  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
      await reload();
    } catch (reason) {
      setActionError(errorText(reason));
    }
  };

  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">Loading...</p>;
  }
  const { client, can, staff, members } = data.detail;
  const update = (patch: Partial<Client>) =>
    run(() => api(`/clients/${client.clientId}`, { method: 'PUT', body: patch }));

  return (
    <section>
      <header className="page-header">
        <a href={href.clients()} className="muted">
          Clients
        </a>
        <h1>{client.name}</h1>
        <span className={`badge ${client.status}`}>{client.status}</span>
      </header>
      {actionError && <p className="error">{actionError}</p>}

      {can.includes('client:update') && <DetailsForm client={client} onSave={update} />}

      {(can.includes('payment:toggle') || can.includes('client:archive')) && (
        <div className="panel">
          <h2>Account</h2>
          {can.includes('payment:toggle') && (
            <label className="toggle">
              <input
                type="checkbox"
                checked={client.paymentRequired}
                onChange={(event) => update({ paymentRequired: event.target.checked })}
              />
              Payment required before download
            </label>
          )}
          {can.includes('client:archive') && (
            <button
              className="button"
              onClick={() => update({ status: client.status === 'active' ? 'archived' : 'active' })}
            >
              {client.status === 'active' ? 'Archive client' : 'Restore client'}
            </button>
          )}
        </div>
      )}

      {staff && data.staffOptions && (
        <StaffPanel
          assigned={staff}
          options={data.staffOptions}
          onSave={(userIds) =>
            run(() =>
              api(`/clients/${client.clientId}/staff`, { method: 'PUT', body: { userIds } }),
            )
          }
        />
      )}

      {members && (
        <div className="panel">
          <h2>Client users</h2>
          {members.length === 0 ? (
            <p className="muted">No users yet.</p>
          ) : (
            <ul className="plain-list">
              {members.map((member) => (
                <li key={member.userId}>
                  {member.name} <span className="muted">{member.email}</span>{' '}
                  {member.status === 'disabled' && <span className="badge disabled">disabled</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {can.includes('user:invite') && (
        <InviteForm roles={data.roles} fixedClientId={client.clientId} onInvited={reload} />
      )}
    </section>
  );
}

function DetailsForm({
  client,
  onSave,
}: {
  client: Client;
  onSave: (patch: Partial<Client>) => void;
}) {
  const [name, setName] = useState(client.name);
  const [website, setWebsite] = useState(client.website ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ name, website: website || undefined });
  };
  return (
    <form className="panel form-grid" onSubmit={submit}>
      <h2>Details</h2>
      <label>
        Name
        <input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Website
        <input
          type="url"
          placeholder="https://"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>
      <div className="form-actions">
        <button className="button primary">Save</button>
      </div>
    </form>
  );
}

interface StaffPanelProps {
  assigned: User[];
  options: User[];
  onSave: (userIds: string[]) => void;
}

function StaffPanel({ assigned, options, onSave }: StaffPanelProps) {
  const [selected, setSelected] = useState(() => new Set(assigned.map((user) => user.userId)));
  const toggle = (userId: string) => {
    const next = new Set(selected);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    setSelected(next);
  };
  return (
    <div className="panel">
      <h2>Assigned staff</h2>
      {options.length === 0 && <p className="muted">No active staff users.</p>}
      <ul className="plain-list">
        {options.map((user) => (
          <li key={user.userId}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={selected.has(user.userId)}
                onChange={() => toggle(user.userId)}
              />
              {user.name} <span className="muted">{user.email}</span>
            </label>
          </li>
        ))}
      </ul>
      <button className="button primary" onClick={() => onSave([...selected])}>
        Save assignments
      </button>
    </div>
  );
}
