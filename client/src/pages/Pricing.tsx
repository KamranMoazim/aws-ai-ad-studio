import { useState } from 'react';
import { api, errorText } from '../lib/api';
import { formatMoney, type Price } from '../lib/types';
import { useLoad } from '../lib/useLoad';

const CURRENCIES = ['usd', 'eur', 'gbp', 'cad', 'aud'];

interface PriceList {
  taskTypes: Record<string, string>;
  prices: Price[];
}

export function PriceTable({
  path,
  taskTypes,
  prices,
  onChanged,
  emptyLabel,
}: {
  path: string;
  taskTypes: Record<string, string>;
  prices: Price[];
  onChanged: () => void;
  emptyLabel: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, { amount: string; currency: string }>>({});
  const [error, setError] = useState<string | undefined>();
  const byType = new Map(prices.map((price) => [price.taskType, price]));

  const draftFor = (taskType: string) => {
    const price = byType.get(taskType);
    return (
      drafts[taskType] ?? {
        amount: price ? (price.amountCents / 100).toFixed(2) : '',
        currency: price?.currency ?? 'usd',
      }
    );
  };

  const save = async (taskType: string) => {
    setError(undefined);
    const draft = draftFor(taskType);
    try {
      if (!draft.amount) {
        await api(`${path}/${taskType}`, { method: 'DELETE' });
      } else {
        await api(`${path}/${taskType}`, {
          method: 'PUT',
          body: { amountCents: Math.round(Number(draft.amount) * 100), currency: draft.currency },
        });
      }
      setDrafts({ ...drafts, [taskType]: undefined! });
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <>
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Current</th>
            <th>New price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Object.entries(taskTypes).map(([taskType, label]) => {
            const price = byType.get(taskType);
            const draft = draftFor(taskType);
            return (
              <tr key={taskType}>
                <td>{label}</td>
                <td>
                  {price ? (
                    formatMoney(price.amountCents, price.currency)
                  ) : (
                    <span className="muted">{emptyLabel}</span>
                  )}
                </td>
                <td>
                  <span className="color-input">
                    <input
                      type="number"
                      min="0.5"
                      step="0.01"
                      aria-label={`${label} amount`}
                      value={draft.amount}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [taskType]: { ...draft, amount: event.target.value },
                        })
                      }
                    />
                    <select
                      aria-label={`${label} currency`}
                      value={draft.currency}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [taskType]: { ...draft, currency: event.target.value },
                        })
                      }
                    >
                      {CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency.toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </span>
                </td>
                <td>
                  <button className="link-button" onClick={() => save(taskType)}>
                    {draft.amount ? 'Save' : price ? 'Remove' : 'Save'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function PricingPage() {
  const { data, error, reload } = useLoad(() => api<PriceList>('/prices'), []);
  return (
    <section>
      <header className="page-header">
        <h1>Pricing</h1>
      </header>
      <p className="muted">
        Prices are charged through Stripe Checkout before the final download, for clients with
        "Payment required" switched on. Leave a price empty to remove it; exports that need it are
        refused until it is set.
      </p>
      {error && <p className="error">{error}</p>}
      {data && (
        <PriceTable
          path="/prices"
          taskTypes={data.taskTypes}
          prices={data.prices}
          onChanged={reload}
          emptyLabel="Not set"
        />
      )}
    </section>
  );
}
