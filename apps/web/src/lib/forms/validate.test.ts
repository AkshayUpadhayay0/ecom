import { loginRequestSchema, registerRequestSchema } from '@urban-ibile/shared';
import { describe, expect, it } from 'vitest';
import { blankToUndefined, validate } from './validate';

const loginForm = loginRequestSchema.omit({ client: true });
const registerForm = registerRequestSchema.omit({ client: true });

describe('validate', () => {
  it('accepts valid login values and normalises the email', () => {
    const result = validate(loginForm, { email: '  Ada@Example.COM ', password: 'x' });
    expect(result).toEqual({ ok: true, data: { email: 'ada@example.com', password: 'x' } });
  });

  it('maps issues to dictionary keys, one per field', () => {
    const result = validate(loginForm, { email: 'nope', password: '' });
    expect(result).toEqual({
      ok: false,
      errors: { email: 'form.error.email', password: 'form.error.required' },
    });
  });

  it('flags a missing required field as required', () => {
    const result = validate(registerForm, {
      email: 'a@b.co',
      password: 'secret-pass-1',
      acceptTerms: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.fullName).toBe('form.error.required');
  });

  it('requires the terms to be accepted and checks the phone format', () => {
    const result = validate(registerForm, {
      email: 'a@b.co',
      password: 'secret-pass-1',
      fullName: 'Ada',
      phone: 'abc',
      acceptTerms: false,
    });
    expect(result).toEqual({
      ok: false,
      errors: { phone: 'form.error.phone', acceptTerms: 'form.error.terms' },
    });
  });

  it('limits overly long passwords', () => {
    const result = validate(loginForm, { email: 'a@b.co', password: 'x'.repeat(200) });
    expect(result).toEqual({ ok: false, errors: { password: 'form.error.too_long' } });
  });
});

describe('blankToUndefined', () => {
  it('treats blank as not provided', () => {
    expect(blankToUndefined('  ')).toBeUndefined();
    expect(blankToUndefined(' +234 ')).toBe('+234');
  });
});
