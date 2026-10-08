import { z } from 'zod';
import { MAX_PAGE_SIZE } from './admin-common.js';

const MINUTES_PER_DAY = 24 * 60;
const MAX_SOCIAL_LINKS = 20;
const MAX_PALETTE_TOKENS = 30;

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'must be a phone number');
const hexColourSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a #RRGGBB colour');

/**
 * Every admin-editable setting: its value schema and, for operational limits, the default used
 * while the value is NULL ("not provided yet"). Unknown keys are rejected. A NULL value is always
 * accepted so pending client decisions can stay empty.
 */
export const SETTING_DEFINITIONS = {
  'catalog.page_size': { schema: z.number().int().min(1).max(MAX_PAGE_SIZE), default: 20 },
  'catalog.max_active_products': { schema: z.number().int().min(1).max(10_000), default: 100 },
  'checkout.reservation_minutes': { schema: z.number().int().min(1).max(120), default: 15 },
  'cart.max_quantity_per_item': { schema: z.number().int().min(1).max(100), default: 10 },
  'qr.grant_ttl_minutes': {
    schema: z
      .number()
      .int()
      .min(1)
      .max(30 * MINUTES_PER_DAY),
    default: MINUTES_PER_DAY,
  },
  // Pending Client Decisions: no defaults, NULL until the client supplies them.
  'support.email': { schema: z.email().max(254) },
  'support.phone': { schema: phoneSchema },
  'support.whatsapp': { schema: phoneSchema },
  'social.links': {
    schema: z
      .array(z.object({ platform: z.string().trim().min(1).max(40), url: z.url() }))
      .max(MAX_SOCIAL_LINKS),
  },
  'brand.palette': {
    schema: z
      .record(
        z.string().regex(/^[a-z][a-zA-Z0-9-]{0,39}$/, 'must be a token name'),
        hexColourSchema,
      )
      .refine((palette) => Object.keys(palette).length <= MAX_PALETTE_TOKENS, 'too many colours'),
  },
  'logistics.provider': { schema: z.string().trim().min(1).max(100) },
  'policy.returns_content_key': {
    schema: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'must be a content block key'),
  },
} as const satisfies Record<string, { schema: z.ZodType; default?: unknown }>;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

/** Body of PATCH /admin/settings/:key. The value itself is validated per key. */
export const updateSettingSchema = z
  .object({ value: z.unknown() })
  .refine((body) => body.value !== undefined, {
    message: 'value is required (use null for "not provided yet")',
    path: ['value'],
  });

export interface SettingDto {
  key: string;
  value: unknown;
  /** Value used by the API while `value` is null, if the setting has one. */
  defaultValue: unknown;
  description: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
