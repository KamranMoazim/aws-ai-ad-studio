import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { accessToken } from '../lib/auth';
import { loadConfig } from '../lib/config';
import { formatMoney, type Client, type Transaction } from '../lib/types';
import { useLoad } from '../lib/useLoad';

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function TransactionTable({
  transactions,
  showClient,
}: {
  transactions: Transaction[];
  showClient: boolean;
}) {
  if (!transactions.length) {
    return <p className="muted">No transactions.</p>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Date</th>
          {showClient && <th>Client</th>}
          <th>Task</th>
          <th>Status</th>
          <th>Amount</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((txn) => (
          <tr key={`${txn.clientId}-${txn.txnId}`}>
            <td>{new Date(txn.createdAt).toLocaleString()}</td>
            {showClient && <td>{txn.clientName ?? txn.clientId}</td>}
            <td>{txn.taskType}</td>
            <td>
              <span className={`badge ${txn.status === 'refunded' ? 'disabled' : 'active'}`}>
                {txn.status}
              </span>
            </td>
            <td>{formatMoney(txn.amountCents, txn.currency)}</td>
            <td>
              {txn.receiptUrl ? (
                <a href={txn.receiptUrl} target="_blank" rel="noreferrer">
                  Receipt
                </a>
              ) : null}
              {txn.stripePaymentIntentId ? (
                <>
                  {' '}
                  <a
                    href={`https://dashboard.stripe.com/payments/${txn.stripePaymentIntentId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Stripe
                  </a>
                </>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TransactionsPage() {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(daysAgo(0));
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | undefined>();
  const query = new URLSearchParams({
    from,
    to,
    ...(clientId ? { clientId } : {}),
    ...(status ? { status } : {}),
  });
  const { data, error: loadError } = useLoad(
    () => api<{ transactions: Transaction[] }>(`/transactions?${query}`),
    [query.toString()],
  );
  const clients = useLoad(() => api<{ clients: Client[] }>('/clients'), []);

  const downloadCsv = async () => {
    setError(undefined);
    try {
      const [{ apiUrl }, token] = await Promise.all([loadConfig(), accessToken()]);
      const response = await fetch(`${apiUrl}/transactions?${query}&format=csv`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Could not export CSV');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `transactions-${from}-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <section>
      <header className="page-header">
        <h1>Transactions</h1>
      </header>
      <div className="inline-form">
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Client
          <select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">All clients</option>
            {(clients.data?.clients ?? []).map((client) => (
              <option key={client.clientId} value={client.clientId}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any</option>
            <option value="paid">Paid</option>
            <option value="exempt">Exempt</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
        <button className="button" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>
      {(error || loadError) && <p className="error">{error ?? loadError}</p>}
      {data && <TransactionTable transactions={data.transactions} showClient />}
    </section>
  );
}
