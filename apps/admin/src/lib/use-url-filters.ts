import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

/**
 * List filters kept in the URL (?status=…&page=2), so filtered lists can be linked to (dashboard
 * tiles) and survive a reload. Changing any filter except `page` resets to page 1.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();

  const values = useMemo(() => {
    const result = {} as Record<K, string>;
    for (const key of keys) result[key] = params.get(key) ?? '';
    return result;
    // keys is a constant list per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const setFilter = useCallback(
    (key: K | 'page', value: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === '') next.delete(key);
          else next.set(key, value);
          if (key !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const active = keys.some((key) => values[key] !== '');
  return {
    values,
    page,
    setFilter,
    setPage: (p: number) => setFilter('page', String(p)),
    clear,
    active,
  };
}
