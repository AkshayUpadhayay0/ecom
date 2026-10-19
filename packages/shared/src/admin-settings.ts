import { z } from 'zod';
import { MAX_PAGE_SIZE } from './admin-common.js';

const MINUTES_PER_DAY = 24 * 60;
const SECONDS_PER_DAY = 24 * 60 * 60;
/** Technical ceiling for any single upload (5 GB, the S3 single-PUT limit). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_DIMENSION = 7680;
const MAX_MEASUREMENT_INCHES = 200;
const inchRangeSchema = z
  .object({
    min: z.number().min(0).max(MAX_MEASUREMENT_INCHES),
    max: z.number().min(0).max(MAX_MEASUREMENT_INCHES),
  })
  .refine((range) => range.min < range.max, 'min must be below max');
/** Sane input range per measurement code (rejects typos); not size rules. */
const measurementLimitsSchema = z.object({
  default: inchRangeSchema,
  byMeasurement: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), inchRangeSchema),
});
export type MeasurementLimits = z.infer<typeof measurementLimitsSchema>;

/** Ascending list of pixel sizes (rendition heights / image widths). */
const dimensionListSchema = z
  .array(z.number().int().min(16).max(MAX_DIMENSION))
  .min(1)
  .max(10)
  .refine(
    (list) => list.every((value, i) => i === 0 || value > (list[i - 1] ?? 0)),
    'must be ascending',
  );
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
  // 9 Oct design: no product cap unless the client sets one (NULL = unlimited).
  'catalog.max_active_products': { schema: z.number().int().min(1).max(100_000) },
  'checkout.reservation_minutes': { schema: z.number().int().min(1).max(120), default: 15 },
  'cart.max_quantity_per_item': { schema: z.number().int().min(1).max(100), default: 10 },
  // Team decision still open: NULL = hidden-page access grants never expire.
  'qr.grant_ttl_minutes': {
    schema: z
      .number()
      .int()
      .min(1)
      .max(30 * MINUTES_PER_DAY),
  },
  // Media pipeline (Phase 3) [TEAM DESIGN values, seeded by migration 0004].
  'media.max_video_bytes': {
    schema: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    default: 524_288_000,
  },
  'media.max_image_bytes': {
    schema: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    default: 20_971_520,
  },
  'media.upload_url_ttl_seconds': {
    schema: z.number().int().min(60).max(SECONDS_PER_DAY),
    default: 900,
  },
  'media.private_url_ttl_seconds': {
    schema: z.number().int().min(30).max(SECONDS_PER_DAY),
    default: 300,
  },
  'media.processing_max_attempts': { schema: z.number().int().min(1).max(20), default: 3 },
  'media.processing_backoff_seconds': {
    schema: z.number().int().min(1).max(SECONDS_PER_DAY),
    default: 60,
  },
  'media.processing_lease_seconds': {
    schema: z.number().int().min(60).max(SECONDS_PER_DAY),
    default: 900,
  },
  'media.preview_seconds': { schema: z.number().int().min(1).max(60), default: 6 },
  'media.video_heights': { schema: dimensionListSchema, default: [480, 720, 1080] },
  'media.image_widths': { schema: dimensionListSchema, default: [320, 640, 1280, 1920] },
  // Blueprint (Phase 5a) [SAMPLE limits; reject_below_chart_min is a Pending Client Decision].
  'blueprint.measurement_limits': {
    schema: measurementLimitsSchema,
    default: { default: { min: 5, max: 90 }, byMeasurement: {} },
  },
  'blueprint.reject_below_chart_min': { schema: z.boolean(), default: false },
  'body_scan.session_ttl_minutes': {
    schema: z.number().int().min(1).max(MINUTES_PER_DAY),
    default: 30,
  },
  // Commerce (Phase 5b).
  'store.currency': {
    schema: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code'),
    default: 'NGN',
  },
  'checkout.reservation_max_total_minutes': {
    schema: z.number().int().min(1).max(MINUTES_PER_DAY),
    default: 45,
  },
  // Payments + email outbox (Phase 6) [TEAM DESIGN values, seeded by migration 0008].
  'payments.reconcile_after_minutes': {
    schema: z.number().int().min(1).max(MINUTES_PER_DAY),
    default: 5,
  },
  'payments.reconcile_max_age_hours': { schema: z.number().int().min(1).max(720), default: 48 },
  'payments.reconcile_batch': { schema: z.number().int().min(1).max(1000), default: 50 },
  'email.max_attempts': { schema: z.number().int().min(1).max(50), default: 5 },
  'email.retry_base_seconds': {
    schema: z.number().int().min(1).max(SECONDS_PER_DAY),
    default: 60,
  },
  // Returns (Phase 7b). [TEAM DESIGN] evidence limits, seeded by migration 0010.
  'returns.evidence_max_files': { schema: z.number().int().min(1).max(20), default: 5 },
  'returns.evidence_max_bytes': {
    schema: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    default: 10_485_760,
  },
  // [PENDING CLIENT DECISION] shown in the approval email; PLACEHOLDER text until supplied.
  'returns.return_address': {
    schema: z.string().trim().min(1).max(1000),
    default: 'PLACEHOLDER - return address not decided yet (Pending Client Decision)',
  },
  'returns.return_instructions': {
    schema: z.string().trim().min(1).max(2000),
    default: 'PLACEHOLDER - return instructions not decided yet (Pending Client Decision)',
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

/**
 * Settings a normal admin (role `admin`) may change: client contact details and return address
 * copy. Every other setting is sensitive configuration (payments, media, email, checkout, cart,
 * catalog, QR, Blueprint, currency, logistics, palette, policy keys) and is super_admin only.
 * Enforced by the API (PATCH /admin/settings/:key); the admin UI greys out the rest.
 */
export const ADMIN_EDITABLE_SETTING_KEYS = [
  'support.email',
  'support.phone',
  'support.whatsapp',
  'social.links',
  'returns.return_address',
  'returns.return_instructions',
] as const;

export function isAdminEditableSetting(key: string): boolean {
  return (ADMIN_EDITABLE_SETTING_KEYS as readonly string[]).includes(key);
}
