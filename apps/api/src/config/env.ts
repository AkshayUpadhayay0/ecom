import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Repo-root `.env` (src/config -> repo root is four levels up; same depth from dist/config).
// Variables already present in the process environment win over the file.
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));
// Default folder for the LOCAL media storage driver (git-ignored), at the repo root.
const DEFAULT_MEDIA_LOCAL_DIR = fileURLToPath(
  new URL('../../../../.media-local/', import.meta.url),
);

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

const commaList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.url()));

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgres:// connection URL');

const MIN_SECRET_LENGTH = 32;
const jwtSecret = z
  .string({ error: 'is required' })
  .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`);

const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: postgresUrl,
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(100).default(2000),
  CORS_ORIGINS: commaList.default([]),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),

  // --- Auth ---
  JWT_ACCESS_SECRET: jwtSecret,
  JWT_ADMIN_ACCESS_SECRET: jwtSecret,
  JWT_ISSUER: z.string().min(1).default('urban-ibile-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  CUSTOMER_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ADMIN_REFRESH_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(64).default(10),
  AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(1).max(100).default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  // Refresh cookies need HTTPS. Forced on in production; off by default for local http.
  COOKIE_SECURE: booleanFlag.default(false),
  // [PENDING] current terms & conditions version recorded at registration.
  TERMS_VERSION: z.string().min(1).default('draft'),

  // --- Email ---
  // Base URL of the customer website, used to build links in emails. [PENDING] production URL.
  PUBLIC_WEB_URL: z.url().default('http://localhost:3000'),
  // [PENDING] sender address; the email provider is not chosen yet (MOCK sender in use).
  EMAIL_FROM: z.string().min(3).default('Urban Ibile <no-reply@example.invalid>'),
  EMAIL_OUTBOX_POLL_MS: z.coerce.number().int().min(500).default(5_000),

  // --- Hidden pages / serial access ---
  // Key for HMAC-SHA256 of serial numbers (only the hash is stored). Changing it invalidates
  // every imported serial, so keep it stable and secret.
  SERIAL_HMAC_SECRET: z
    .string({ error: 'is required' })
    .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`),
  // Unlock attempts: failed attempts count against both limits.
  HIDDEN_UNLOCK_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  HIDDEN_UNLOCK_MAX_PER_IP: z.coerce.number().int().min(1).default(10),
  HIDDEN_UNLOCK_MAX_PER_PAGE: z.coerce.number().int().min(1).default(50),

  // --- Media (Phase 3) ---
  // 'local' = files on disk + signed routes on this API (dev/test, no keys). 'r2' = Cloudflare R2.
  // Production requires 'r2'.
  MEDIA_STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  MEDIA_LOCAL_DIR: z.string().min(1).default(DEFAULT_MEDIA_LOCAL_DIR),
  // Signs local upload/download URLs. Random per process when unset (dev only).
  MEDIA_LOCAL_SECRET: z.string().min(MIN_SECRET_LENGTH).optional(),
  // Public base URL of this API, used to build LOCAL media URLs.
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  R2_ACCOUNT_ID: z.string().min(1).optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_PUBLIC_BUCKET: z.string().min(1).optional(),
  R2_PRIVATE_BUCKET: z.string().min(1).optional(),
  // CDN / public bucket domain for public media, e.g. https://media.example.com
  R2_PUBLIC_BASE_URL: z.url().optional(),
  // Media worker (pnpm worker:media). Paths can be absolute on Windows.
  FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
  FFPROBE_PATH: z.string().min(1).default('ffprobe'),
  FFMPEG_X264_PRESET: z
    .enum(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'])
    .default('veryfast'),
  FFMPEG_X264_CRF: z.coerce.number().int().min(0).max(51).default(23),
  MEDIA_WORKER_POLL_MS: z.coerce.number().int().min(250).default(5_000),
  // Scratch folder for processing (defaults to the OS temp folder).
  MEDIA_TEMP_DIR: z.string().min(1).optional(),
  MEDIA_UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900_000),
  MEDIA_UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
});

const R2_REQUIRED = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BUCKET',
  'R2_PRIVATE_BUCKET',
  'R2_PUBLIC_BASE_URL',
] as const;

const refinedEnvSchema = envSchema
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_ADMIN_ACCESS_SECRET, {
    path: ['JWT_ADMIN_ACCESS_SECRET'],
    message: 'must differ from JWT_ACCESS_SECRET',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.MEDIA_STORAGE_DRIVER === 'r2', {
    path: ['MEDIA_STORAGE_DRIVER'],
    message: "must be 'r2' in production",
  })
  .superRefine((env, ctx) => {
    if (env.MEDIA_STORAGE_DRIVER !== 'r2') return;
    for (const key of R2_REQUIRED) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: "is required when MEDIA_STORAGE_DRIVER is 'r2'",
        });
      }
    }
  })
  .refine(
    (env) =>
      env.SERIAL_HMAC_SECRET !== env.JWT_ACCESS_SECRET &&
      env.SERIAL_HMAC_SECRET !== env.JWT_ADMIN_ACCESS_SECRET,
    { path: ['SERIAL_HMAC_SECRET'], message: 'must differ from the JWT secrets' },
  )
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE || env.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof refinedEnvSchema>;

export class EnvValidationError extends Error {
  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lines = issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Parses and validates configuration. Throws EnvValidationError listing every problem. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = refinedEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }
  return result.data;
}

/** Loads the repo-root `.env` (if present) into process.env, then validates it. */
export function loadEnv(): Env {
  loadDotenv({ path: ROOT_ENV_FILE, quiet: true });
  return parseEnv(process.env);
}
