import { useState, type FormEvent } from 'react';
import { api, errorText } from '../lib/api';
import type { Client, Role, UserType } from '../lib/types';

interface InviteFormProps {
  roles: Role[];
  clients?: Client[];
  fixedClientId?: string;
  onInvited: () => void;
}

export function InviteForm({ roles, clients, fixedClientId, onInvited }: InviteFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<UserType>(fixedClientId ? 'client' : 'staff');
  const [roleId, setRoleId] = useState('');
  const [clientId, setClientId] = useState(fixedClientId ?? '');
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const typeRoles = roles.filter((role) => role.type === type);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await api('/users', {
        method: 'POST',
        body: {
          email,
          name,
          type,
          roleIds: [roleId || typeRoles[0]?.roleId],
          clientId: type === 'client' ? clientId : undefined,
        },
      });
      setNotice(`Invitation sent to ${email}.`);
      setEmail('');
      setName('');
      onInvited();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <h2>Invite a user</h2>
      <label>
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Name
        <input required value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {!fixedClientId && (
        <label>
          Type
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as UserType);
              setRoleId('');
            }}
          >
            <option value="staff">Staff</option>
            <option value="client">Client user</option>
          </select>
        </label>
      )}
      <label>
        Role
        <select value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          {typeRoles.map((role) => (
            <option key={role.roleId} value={role.roleId}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      {type === 'client' && !fixedClientId && (
        <label>
          Client
          <select required value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Choose a client</option>
            {(clients ?? []).map((client) => (
              <option key={client.clientId} value={client.clientId}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          Send invitation
        </button>
        {notice && <span className="notice">{notice}</span>}
        {error && <span className="error">{error}</span>}
      </div>
    </form>
  );
}
