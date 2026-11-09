import { useCallback, useEffect, useState } from 'react';
import { errorText } from './api';

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const run = useCallback(load, deps);

  const reload = useCallback(() => {
    setError(undefined);
    return run()
      .then(setData)
      .catch((reason) => setError(errorText(reason)));
  }, [run]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, reload };
}
