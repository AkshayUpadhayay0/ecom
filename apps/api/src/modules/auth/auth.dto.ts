import type { CustomerDto } from '@urban-ibile/shared';
import type { CustomerRow } from './auth.repository.js';

export function toCustomerDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    preferredLanguage: row.preferredLanguage,
    emailVerified: row.emailVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
