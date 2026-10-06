import type { AdminDto } from '@urban-ibile/shared';
import type { AdminRow } from './admin-users.repository.js';

export function toAdminDto(row: AdminRow): AdminDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
  };
}
