import { SETTING_DEFINITIONS, isSettingKey, type SettingDto } from '@urban-ibile/shared';
import type { SettingRow } from './settings.repository.js';

function defaultOf(key: string): unknown {
  if (!isSettingKey(key)) return null;
  const definition = SETTING_DEFINITIONS[key];
  return 'default' in definition ? definition.default : null;
}

export function toSettingDto(key: string, row: SettingRow | undefined): SettingDto {
  return {
    key,
    value: row?.value ?? null,
    defaultValue: defaultOf(key),
    description: row?.description ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}
