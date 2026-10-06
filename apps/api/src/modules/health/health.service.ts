import { withTimeout } from '../../lib/with-timeout.js';
import type { HealthRepository } from './health.repository.js';

export type HealthReport = { database: 'up' } | { database: 'down'; reason: string };

export interface HealthService {
  check(): Promise<HealthReport>;
}

export interface HealthServiceDeps {
  repository: HealthRepository;
  dbTimeoutMs: number;
}

export function createHealthService({ repository, dbTimeoutMs }: HealthServiceDeps): HealthService {
  return {
    async check() {
      try {
        await withTimeout(repository.ping(), dbTimeoutMs);
        return { database: 'up' };
      } catch (err) {
        return { database: 'down', reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
