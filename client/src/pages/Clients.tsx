import { useState, type FormEvent } from 'react';
import { href } from '../app/routes';
import { api, errorText } from '../lib/api';
import type { Client, Me } from '../lib/types';
import { useLoad } from '../lib/useLoad';

export function ClientsPage({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(() => api<{ clients: Client[] }>('/clients'), []);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | undefined>();
  const canCreate = me.can.includes('client:create');

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(undefined);
    try {
      await api('/clients', { method: 'POST', body: { name } });
      setName('');
      await reload();
    } catch (reason) {
      setFormError(errorText(reason));
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Clients</h1>
      </header>
      {canCreate && (
        <form className="inline-form" onSubmit={create}>
          <input
            placeholder="New client name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="button primary">Add client</button>
          {formError && <p className="error">{formError}</p>}
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {data && data.clients.length === 0 && <p className="muted">No clients yet.</p>}
      {data && data.clients.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Payment</th>
            </tr>
          </thead>
          <tbody>
            {data.clients.map((client) => (
              <tr key={client.clientId}>
                <td>
                  <a href={href.client(client.clientId)}>{client.name}</a>
                </td>
                <td>
                  <span className={`badge ${client.status}`}>{client.status}</span>
                </td>
                <td>{client.paymentRequired ? 'Required' : 'Exempt'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
