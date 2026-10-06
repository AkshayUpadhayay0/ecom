const DEV_FALLBACK_API_BASE_URL = 'http://localhost:4000/api/v1';

/** API base URL including `/api/v1`, without a trailing slash. */
export function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (import.meta.env.DEV || import.meta.env.MODE === 'test') return DEV_FALLBACK_API_BASE_URL;
  throw new Error('VITE_API_BASE_URL is not set. See apps/admin/.env.example.');
}
