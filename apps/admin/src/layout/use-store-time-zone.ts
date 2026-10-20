import { useQuery } from '@tanstack/react-query';
import { DEFAULT_STORE_TIME_ZONE } from '@urban-ibile/shared';
import { configApi } from '@/lib/api/config-api';
import { setStoreTimeZone } from '@/lib/format';

/** Same key as the Settings page, so saving `store.timezone` refreshes every displayed date. */
export const SETTINGS_QUERY_KEY = ['config', 'settings'] as const;

/**
 * The store time zone (setting `store.timezone`, default Africa/Lagos) for every date shown in
 * the admin app. Applied to the shared formatters synchronously, before children render; the
 * layout keys its page outlet on the value so pages re-render if a super admin changes it.
 */
export function useStoreTimeZone(): string {
  const settings = useQuery({ queryKey: SETTINGS_QUERY_KEY, queryFn: configApi.settings });
  const stored = settings.data?.find((s) => s.key === 'store.timezone');
  const value = stored?.value ?? stored?.defaultValue;
  const timeZone = typeof value === 'string' ? value : DEFAULT_STORE_TIME_ZONE;
  setStoreTimeZone(timeZone);
  return timeZone;
}
