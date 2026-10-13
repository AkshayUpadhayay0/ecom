import type { Database } from '../../db/database.js';

export interface MeasurementProfileRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/**
 * Read access to measurement profiles (which body measurements Blueprint needs for a product).
 * Profiles are loaded by developers with the size charts; the admin only picks one per product.
 */
export interface MeasurementProfilesRepository {
  findById(db: Database, id: string): Promise<MeasurementProfileRow | undefined>;
}

export function createMeasurementProfilesRepository(): MeasurementProfilesRepository {
  return {
    async findById(db, id) {
      return db
        .selectFrom('measurement_profiles')
        .select(['id', 'code', 'name', 'is_active as isActive'])
        .where('id', '=', id)
        .executeTakeFirst();
    },
  };
}
