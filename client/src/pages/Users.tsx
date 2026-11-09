import { useState } from 'react';
import { InviteForm } from '../components/InviteForm';
import { api, errorText } from '../lib/api';
import type { Client, Me, Role, User } from '../lib/types';
import { useLoad } from '../lib/useLoad';

interface UsersData {
  users: User[];
  roles: Role[];
  clients: Client[];
}

async function loadUsers(): Promise<UsersData> {
  const [users, roles, clients] = await Promise.all([
    api<{ users: User[] }>('/users'),
    api<{ roles: Role[] }>('/roles'),
    api<{ clients: Client[] }>('/clients'),
  ]);
  return { users: users.users, roles: roles.roles, clients: clients.clients };
}

export function UsersPage({ me }: { me: Me }) {
  const { data, error, reload } = useLoad(loadUsers, []);
  const [rowError, setRowError] = useState<string | undefined>();

  const update = async (user: User, patch: Partial<Pick<User, 'roleIds' | 'status'>>) => {
    setRowError(undefined);
    try {
      await api(`/users/${user.userId}`, { method: 'PUT', body: patch });
      await reload();
    } catch (reason) {
      setRowError(errorText(reason));
    }
  };

  if (error) {
    return <p className="error">{error}</p>;
  }
  if (!data) {
    return <p className="muted">Loading...</p>;
  }
  const clientNames = new Map(data.clients.map((client) => [client.clientId, client.name]));
  return (
    <section>
      <header className="page-header">
        <h1>Users</h1>
      </header>
      <InviteForm roles={data.roles} clients={data.clients} onInvited={reload} />
      {rowError && <p className="error">{rowError}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Type</th>
            <th>Role</th>
            <th>Client</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.users.map((user) => (
            <tr key={user.userId}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>{user.type}</td>
              <td>
                <select
                  value={user.roleIds[0]}
                  onChange={(event) => update(user, { roleIds: [event.target.value] })}
                >
                  {data.roles
                    .filter((role) => role.type === user.type)
                    .map((role) => (
                      <option key={role.roleId} value={role.roleId}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </td>
              <td>{user.clientId ? (clientNames.get(user.clientId) ?? user.clientId) : ''}</td>
              <td>
                {user.userId === me.user.userId ? (
                  <span className={`badge ${user.status}`}>{user.status}</span>
                ) : (
                  <button
                    className="link-button"
                    onClick={() =>
                      update(user, { status: user.status === 'active' ? 'disabled' : 'active' })
                    }
                  >
                    {user.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
