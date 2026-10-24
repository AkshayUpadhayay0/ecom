import { describe, expect, it } from 'vitest';
import { passwordHint, passwordLengthError } from './password-rules';

const rules = { minLength: 10, maxLength: 128 as const, rejectsCommonPasswords: true };

describe('password rules', () => {
  it('shows the real minimum when the API supplied it, a general hint otherwise', () => {
    expect(passwordHint(rules)).toEqual({ key: 'auth.password.rules', params: { min: 10 } });
    expect(passwordHint(null).key).toBe('auth.password.hint');
  });
  it('flags a password shorter than the minimum', () => {
    expect(passwordLengthError('short', rules)).toBe('form.error.password_short');
    expect(passwordLengthError('exactly-10', rules)).toBeUndefined();
  });
  it('leaves empty passwords to the required check and unknown rules to the API', () => {
    expect(passwordLengthError('', rules)).toBeUndefined();
    expect(passwordLengthError('short', null)).toBeUndefined();
  });
});
