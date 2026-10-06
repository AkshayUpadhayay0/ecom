import { sql } from 'kysely';
import type { Database } from '../../db/database.js';

export interface HealthRepository {
  /** Round-trips a trivial query; rejects if the database is unreachable. */
  ping(): Promise<void>;
}

export function createHealthRepository(db: Database): HealthRepository {
  return {
    async ping() {
      await sql`select 1`.execute(db);
    },
  };
}
