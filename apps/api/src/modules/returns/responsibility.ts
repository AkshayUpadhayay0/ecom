import type { ReturnPayer, ReturnResponsibility } from '@urban-ibile/shared';

/*
 * Fault-Line (9 Oct design, CLAUDE.md 8b / SKILL.md 9c). Responsibility is decided here by the
 * backend; a client value is never accepted. Responsibility is NOT the workflow status.
 */

export type SelectionMode = 'LOCKED_RECOMMENDATION' | 'OVERRIDE';

export const FAULT_CAUSES = {
  BLUEPRINT_FAILURE: 'BLUEPRINT_FAILURE',
  WRONG_ITEM_DELIVERED: 'WRONG_ITEM_DELIVERED',
  DEFECTIVE_ITEM: 'DEFECTIVE_ITEM',
  CUSTOMER_OVERRODE_RECOMMENDATION: 'CUSTOMER_OVERRODE_RECOMMENDATION',
  CHANGED_MIND: 'CHANGED_MIND',
} as const;

/** Causes allowed per responsibility (REVIEW_REQUIRED has none). */
export const CAUSES_BY_RESPONSIBILITY: Record<ReturnResponsibility, readonly string[]> = {
  BRAND_FAULT: [
    FAULT_CAUSES.BLUEPRINT_FAILURE,
    FAULT_CAUSES.WRONG_ITEM_DELIVERED,
    FAULT_CAUSES.DEFECTIVE_ITEM,
  ],
  CUSTOMER_FAULT: [FAULT_CAUSES.CUSTOMER_OVERRODE_RECOMMENDATION, FAULT_CAUSES.CHANGED_MIND],
  REVIEW_REQUIRED: [],
};

/** Default reverse-logistics payer for a responsibility. */
export const DEFAULT_PAYER: Record<ReturnResponsibility, ReturnPayer> = {
  CUSTOMER_FAULT: 'CUSTOMER',
  BRAND_FAULT: 'BRAND',
  REVIEW_REQUIRED: 'UNDECIDED',
};

export interface Classification {
  responsibility: ReturnResponsibility;
  faultCause: string | null;
  payer: ReturnPayer;
  /** Why (stored as fault_basis). */
  basis: string;
}

/**
 * Initial classification at creation.
 *  A) does_not_fit + OVERRIDE                 -> CUSTOMER_FAULT / CUSTOMER_OVERRODE_RECOMMENDATION
 *  C) changed_mind                            -> CUSTOMER_FAULT / CHANGED_MIND
 *  B) does_not_fit + LOCKED_RECOMMENDATION    -> REVIEW_REQUIRED (BRAND_FAULT only after review)
 *     wrong_item, damaged_faulty, other, does_not_fit without a decision -> REVIEW_REQUIRED
 */
export function classifyReturn(
  reasonCode: string,
  selectionMode: SelectionMode | null,
): Classification {
  if (reasonCode === 'changed_mind') {
    return {
      responsibility: 'CUSTOMER_FAULT',
      faultCause: FAULT_CAUSES.CHANGED_MIND,
      payer: 'CUSTOMER',
      basis: 'scenario_c_changed_mind',
    };
  }
  if (reasonCode === 'does_not_fit' && selectionMode === 'OVERRIDE') {
    return {
      responsibility: 'CUSTOMER_FAULT',
      faultCause: FAULT_CAUSES.CUSTOMER_OVERRODE_RECOMMENDATION,
      payer: 'CUSTOMER',
      basis: 'scenario_a_override_does_not_fit',
    };
  }
  let basis: string;
  if (reasonCode === 'does_not_fit') {
    basis =
      selectionMode === 'LOCKED_RECOMMENDATION'
        ? 'scenario_b_locked_fit_review'
        : 'does_not_fit_no_blueprint_decision';
  } else {
    basis = `${reasonCode}_review`;
  }
  return { responsibility: 'REVIEW_REQUIRED', faultCause: null, payer: 'UNDECIDED', basis };
}

export type ResponsibilityProblem = 'CAUSE_NOT_ALLOWED' | 'BLUEPRINT_FAILURE_NEEDS_LOCKED_DECISION';

/** Validates an admin's responsibility change (role checks are done by the service). */
export function checkResponsibilityChange(
  responsibility: ReturnResponsibility,
  faultCause: string | null,
  selectionMode: SelectionMode | null,
): ResponsibilityProblem | null {
  const allowed = CAUSES_BY_RESPONSIBILITY[responsibility];
  if (
    allowed.length === 0
      ? faultCause !== null
      : faultCause === null || !allowed.includes(faultCause)
  ) {
    return 'CAUSE_NOT_ALLOWED';
  }
  // Scenario B: only a LOCKED recommendation can be a Blueprint failure (decision 16 Oct 2026).
  if (faultCause === FAULT_CAUSES.BLUEPRINT_FAILURE && selectionMode !== 'LOCKED_RECOMMENDATION') {
    return 'BLUEPRINT_FAILURE_NEEDS_LOCKED_DECISION';
  }
  return null;
}

/** Customer-facing wording of who covers return costs (never says "fault"). */
export function returnCostsLabel(payer: ReturnPayer): string {
  switch (payer) {
    case 'CUSTOMER':
      return 'Return delivery is paid by you.';
    case 'BRAND':
      return 'Return delivery is covered by Urban Ibile.';
    case 'UNDECIDED':
      return 'We are reviewing your request.';
  }
}
