import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/useLoad';

interface Entry {
  actor: string;
  action: string;
  target: string;
  detail?: Record<string, unknown>;
  at: string;
}

export function AuditPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error } = useLoad(
    () => api<{ entries: Entry[] }>(`/audit?month=${month}`),
    [month],
  );
  return (
    <section>
      <header className="page-header">
        <h1>Audit log</h1>
      </header>
      <div className="inline-form">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {data && data.entries.length === 0 && <p className="muted">Nothing recorded this month.</p>}
      {data && data.entries.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, index) => (
              <tr key={`${entry.at}-${index}`}>
                <td>{new Date(entry.at).toLocaleString()}</td>
                <td>{entry.actor}</td>
                <td>{entry.action}</td>
                <td>{entry.target}</td>
                <td className="wrap">
                  <code>{entry.detail ? JSON.stringify(entry.detail).slice(0, 200) : ''}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
