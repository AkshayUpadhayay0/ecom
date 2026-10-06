import { z } from 'zod';

/** Hard upper bound (argon2 input-size DoS guard). The minimum is server policy. */
export const PASSWORD_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;
const NAME_MAX_LENGTH = 120;
const TOKEN_MAX_LENGTH = 512;

export const AUTH_CLIENTS = ['web', 'ios', 'android'] as const;
export const authClientSchema = z.enum(AUTH_CLIENTS);
export type AuthClient = z.infer<typeof authClientSchema>;

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(EMAIL_MAX_LENGTH));
export const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const fullNameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'must be a phone number');
const tokenSchema = z.string().min(1).max(TOKEN_MAX_LENGTH);

// ---------- Customer auth ----------

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  phone: phoneSchema.optional(),
  acceptTerms: z.literal(true, { error: 'Terms must be accepted' }),
  client: authClientSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  client: authClientSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Mobile clients send the refresh token in the body; web sends it as an httpOnly cookie. */
export const refreshRequestSchema = z.object({ refreshToken: tokenSchema.optional() });
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const updateMeRequestSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    preferredLanguage: z.string().trim().min(2).max(10).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

export const verifyEmailRequestSchema = z.object({ token: tokenSchema });
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export const resetPasswordRequestSchema = z.object({
  token: tokenSchema,
  newPassword: passwordSchema,
});

// ---------- Admin auth ----------

export const adminLoginRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export const adminChangePasswordRequestSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

// ---------- Response DTOs ----------

export interface AuthTokensDto {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Only for ios/android. Web and admin receive it as an httpOnly cookie instead. */
  refreshToken?: string;
  refreshTokenExpiresAt: string;
}

export interface CustomerDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  preferredLanguage: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface CustomerAuthDto {
  customer: CustomerDto;
  tokens: AuthTokensDto;
}

export interface AdminDto {
  id: string;
  email: string;
  displayName: string;
  role: 'super_admin' | 'admin';
  mustChangePassword: boolean;
}

export interface AdminAuthDto {
  admin: AdminDto;
  tokens: AuthTokensDto;
}
