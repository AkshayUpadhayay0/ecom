import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Repo-root `.env` (src/config -> repo root is four levels up; same depth from dist/config).
// Variables already present in the process environment win over the file.
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

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
});

const refinedEnvSchema = envSchema
  .refine((env) => env.JWT_ACCESS_SECRET !== env.JWT_ADMIN_ACCESS_SECRET, {
    path: ['JWT_ADMIN_ACCESS_SECRET'],
    message: 'must differ from JWT_ACCESS_SECRET',
  })
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
