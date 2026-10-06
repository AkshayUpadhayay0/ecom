import { z } from 'zod';

export type EmailTemplate = 'email_verification' | 'password_reset';

/** Payload stored in email_outbox.payload. */
export interface EmailPayload {
  fullName: string;
  link: string;
}

const payloadSchema = z.object({ fullName: z.string(), link: z.string() });

/**
 * Templates whose payload contains a one-time secret link. Their payload is replaced after
 * sending so the raw token does not stay in the database.
 */
export const SENSITIVE_TEMPLATES: ReadonlySet<string> = new Set<EmailTemplate>([
  'email_verification',
  'password_reset',
]);

export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * TEMP: English-only plain-text templates. Final copy, Pidgin versions (approved by the
 * client's writer) and HTML layout arrive with the email provider decision.
 */
export function renderEmail(template: string, rawPayload: unknown): RenderedEmail {
  const payload = payloadSchema.parse(rawPayload);
  switch (template) {
    case 'email_verification':
      return {
        subject: 'Confirm your Urban Ibile email',
        text: `Hi ${payload.fullName},\n\nConfirm your email address by opening this link:\n${payload.link}\n\nIf you did not create an account, ignore this email.`,
      };
    case 'password_reset':
      return {
        subject: 'Reset your Urban Ibile password',
        text: `Hi ${payload.fullName},\n\nReset your password with this link:\n${payload.link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`,
      };
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}
