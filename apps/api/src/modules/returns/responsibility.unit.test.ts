import { describe, expect, it } from 'vitest';
import { checkResponsibilityChange, classifyReturn, returnCostsLabel } from './responsibility.js';

describe('Fault-Line classification (backend-decided)', () => {
  it.each([
    ['does_not_fit', 'OVERRIDE', 'CUSTOMER_FAULT', 'CUSTOMER_OVERRODE_RECOMMENDATION', 'CUSTOMER'],
    ['changed_mind', 'LOCKED_RECOMMENDATION', 'CUSTOMER_FAULT', 'CHANGED_MIND', 'CUSTOMER'],
    ['changed_mind', null, 'CUSTOMER_FAULT', 'CHANGED_MIND', 'CUSTOMER'],
    ['does_not_fit', 'LOCKED_RECOMMENDATION', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
    ['does_not_fit', null, 'REVIEW_REQUIRED', null, 'UNDECIDED'],
    ['wrong_item', 'OVERRIDE', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
    ['damaged_faulty', 'LOCKED_RECOMMENDATION', 'REVIEW_REQUIRED', null, 'UNDECIDED'],
    ['other', null, 'REVIEW_REQUIRED', null, 'UNDECIDED'],
  ] as const)('%s + %s -> %s / %s / %s', (reason, mode, responsibility, cause, payer) => {
    const result = classifyReturn(reason, mode);
    expect(result).toMatchObject({ responsibility, faultCause: cause, payer });
    expect(result.basis.length).toBeGreaterThan(0);
  });

  it('validates admin changes: causes per responsibility and scenario B', () => {
    expect(
      checkResponsibilityChange('BRAND_FAULT', 'BLUEPRINT_FAILURE', 'LOCKED_RECOMMENDATION'),
    ).toBeNull();
    expect(checkResponsibilityChange('BRAND_FAULT', 'BLUEPRINT_FAILURE', 'OVERRIDE')).toBe(
      'BLUEPRINT_FAILURE_NEEDS_LOCKED_DECISION',
    );
    expect(checkResponsibilityChange('BRAND_FAULT', 'BLUEPRINT_FAILURE', null)).toBe(
      'BLUEPRINT_FAILURE_NEEDS_LOCKED_DECISION',
    );
    expect(checkResponsibilityChange('BRAND_FAULT', 'WRONG_ITEM_DELIVERED', null)).toBeNull();
    expect(checkResponsibilityChange('BRAND_FAULT', 'CHANGED_MIND', null)).toBe(
      'CAUSE_NOT_ALLOWED',
    );
    expect(checkResponsibilityChange('BRAND_FAULT', null, null)).toBe('CAUSE_NOT_ALLOWED');
    expect(checkResponsibilityChange('CUSTOMER_FAULT', 'CHANGED_MIND', null)).toBeNull();
    expect(checkResponsibilityChange('REVIEW_REQUIRED', null, null)).toBeNull();
    expect(checkResponsibilityChange('REVIEW_REQUIRED', 'DEFECTIVE_ITEM', null)).toBe(
      'CAUSE_NOT_ALLOWED',
    );
  });

  it('uses neutral customer wording', () => {
    for (const payer of ['CUSTOMER', 'BRAND', 'UNDECIDED'] as const) {
      expect(returnCostsLabel(payer)).not.toMatch(/fault/i);
    }
  });
});
