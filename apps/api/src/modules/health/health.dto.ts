import type { HealthDto } from '@urban-ibile/shared';

export function toHealthDto(uptimeSeconds: number, now: Date): HealthDto {
  return {
    status: 'ok',
    db: 'up',
    uptimeSeconds: Math.floor(uptimeSeconds),
    timestamp: now.toISOString(),
  };
}
