import { api } from '../../lib/api';
import type { Transaction } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';
import { TransactionTable } from '../Transactions';

export function PaymentsTab({ clientId }: { clientId: string }) {
  const { data, error } = useLoad(
    () => api<{ transactions: Transaction[] }>(`/clients/${clientId}/transactions`),
    [clientId],
  );
  if (error) {
    return <p className="error">{error}</p>;
  }
  return data ? (
    <TransactionTable transactions={data.transactions} showClient={false} />
  ) : (
    <p className="muted">Loading...</p>
  );
}
