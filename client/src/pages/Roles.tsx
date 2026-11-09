import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { useLoad } from '../lib/useLoad';

type Scope = 'all' | 'assigned' | 'own';

interface Grant {
  actions: string[];
  scope: Scope;
}

interface RoleRecord {
  roleId: string;
  name: string;
  type: 'staff' | 'client';
  builtIn: boolean;
  grants: Grant[];
}

const GROUPS: Array<[string, string[]]> = [
  [
    'Clients',
    [
      'client:read',
      'client:create',
      'client:update',
      'client:archive',
      'client:assign-staff',
      'user:invite',
    ],
  ],
  [
    'Ad sets',
    ['project:create', 'project:read', 'project:edit', 'project:export', 'project:download'],
  ],
  ['Brand kits', ['brandkit:read', 'brandkit:edit']],
  ['Templates', ['template:read', 'template:create', 'template:publish']],
  ['Payments', ['txn:read', 'payment:toggle', 'pricing:manage']],
  ['Administration', ['user:manage', 'role:manage', 'settings:manage', 'audit:read']],
];
const ORG_ONLY = new Set([
  'client:create',
  'template:create',
  'pricing:manage',
  'user:manage',
  'role:manage',
  'settings:manage',
  'audit:read',
]);
const SCOPES: Record<RoleRecord['type'], Array<[Scope, string]>> = {
  staff: [
    ['all', 'All clients'],
    ['assigned', 'Assigned clients only'],
  ],
  client: [['own', 'Their own client']],
};

function Editor({
  role,
  onSaved,
  onCancel,
}: {
  role: RoleRecord;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [roleId, setRoleId] = useState(role.roleId);
  const [type, setType] = useState(role.type);
  const [scope, setScope] = useState<Scope>(
    role.grants.find((grant) => grant.scope !== 'all')?.scope ??
      (role.type === 'client' ? 'own' : 'all'),
  );
  const [actions, setActions] = useState(
    () => new Set(role.grants.flatMap((grant) => grant.actions)),
  );
  const [error, setError] = useState<string | undefined>();
  const isNew = !role.roleId;

  const toggle = (action: string) => {
    const next = new Set(actions);
    if (next.has(action)) {
      next.delete(action);
    } else {
      next.add(action);
    }
    setActions(next);
  };

  const save = async () => {
    setError(undefined);
    const chosen = [...actions];
    const orgWide = chosen.filter((action) => ORG_ONLY.has(action));
    const scoped = chosen.filter((action) => !ORG_ONLY.has(action));
    const grants: Grant[] = [];
    if (type === 'client') {
      if (orgWide.length) {
        setError('Client roles cannot have agency-wide permissions');
        return;
      }
      grants.push({ actions: scoped, scope: 'own' });
    } else {
      if (orgWide.length) {
        grants.push({ actions: orgWide, scope: 'all' });
      }
      if (scoped.length) {
        grants.push({ actions: scoped, scope });
      }
    }
    try {
      await api(`/roles/${encodeURIComponent(roleId)}`, {
        method: 'PUT',
        body: { name, type, grants: grants.filter((grant) => grant.actions.length) },
      });
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <div className="panel">
      <h2>{isNew ? 'New role' : `Edit ${role.name}`}</h2>
      <div className="form-grid">
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {isNew && (
          <>
            <label>
              Id
              <input
                value={roleId}
                placeholder="e.g. designer"
                onChange={(event) =>
                  setRoleId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
                }
              />
            </label>
            <label>
              For
              <select
                value={type}
                onChange={(event) => {
                  const value = event.target.value as RoleRecord['type'];
                  setType(value);
                  setScope(value === 'client' ? 'own' : 'all');
                }}
              >
                <option value="staff">Agency staff</option>
                <option value="client">Client users</option>
              </select>
            </label>
          </>
        )}
        <label>
          Applies to
          <select value={scope} onChange={(event) => setScope(event.target.value as Scope)}>
            {SCOPES[type].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {GROUPS.map(([group, list]) => (
        <div key={group} className="builder-section">
          <h3>{group}</h3>
          <div className="lock-list">
            {list
              .filter((action) => type === 'staff' || !ORG_ONLY.has(action))
              .map((action) => (
                <label key={action} className="toggle">
                  <input
                    type="checkbox"
                    checked={actions.has(action)}
                    onChange={() => toggle(action)}
                  />
                  {action}
                </label>
              ))}
          </div>
        </div>
      ))}
      <p className="hint">
        Saving rewrites this role's Cedar policies. Signed-in users pick up the change within a
        minute.
      </p>
      <div className="form-actions">
        <button
          className="button primary"
          disabled={!name.trim() || !roleId || actions.size === 0}
          onClick={save}
        >
          Save role
        </button>
        <button className="button" onClick={onCancel}>
          Cancel
        </button>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  );
}

export function RolesPage() {
  const { data, error, reload } = useLoad(() => api<{ roles: RoleRecord[] }>('/roles'), []);
  const [editing, setEditing] = useState<RoleRecord | undefined>();
  const [message, setMessage] = useState<string | undefined>();

  const remove = async (role: RoleRecord) => {
    if (!window.confirm(`Delete the ${role.name} role?`)) {
      return;
    }
    setMessage(undefined);
    try {
      await api(`/roles/${role.roleId}`, { method: 'DELETE' });
      await reload();
    } catch (reason) {
      setMessage(errorText(reason));
    }
  };

  if (editing) {
    return (
      <Editor
        role={editing}
        onCancel={() => setEditing(undefined)}
        onSaved={() => {
          setEditing(undefined);
          reload();
        }}
      />
    );
  }
  return (
    <section>
      <header className="page-header">
        <h1>Roles</h1>
      </header>
      <button
        className="button primary"
        onClick={() =>
          setEditing({ roleId: '', name: '', type: 'staff', builtIn: false, grants: [] })
        }
      >
        New role
      </button>
      {(error || message) && <p className="error">{error ?? message}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Role</th>
            <th>For</th>
            <th>Permissions</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(data?.roles ?? []).map((role) => (
            <tr key={role.roleId}>
              <td>{role.name}</td>
              <td>{role.type === 'staff' ? 'Staff' : 'Client users'}</td>
              <td className="wrap">
                {role.grants.map((grant) => `${grant.actions.length} (${grant.scope})`).join(', ')}
              </td>
              <td>
                {role.roleId !== 'super-admin' && (
                  <button className="link-button" onClick={() => setEditing(role)}>
                    Edit
                  </button>
                )}{' '}
                {!role.builtIn && (
                  <button className="link-button" onClick={() => remove(role)}>
                    Delete
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
