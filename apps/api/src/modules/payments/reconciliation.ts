import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { PaymentConfirmationService } from './payment-confirmation.service.js';
import type { PaymentsRepository } from './payments.repository.js';

export interface ReconciliationDeps {
  db: Database;
  payments: PaymentsRepository;
  confirmation: PaymentConfirmationService;
  settings: SettingsService;
  logger: Logger;
}

export interface ReconciliationResult {
  checked: number;
  resolved: number;
  abandoned: number;
}

/**
 * Backup for missed webhooks (run by `pnpm worker`): attempts still unresolved after
 * payments.reconcile_after_minutes are verified with the provider and confirmed through the same
 * routine as the webhook. Each attempt is leased (FOR UPDATE SKIP LOCKED + last_checked_at), so
 * two runs never check the same one; confirmation itself is idempotent. Attempts older than
 * payments.reconcile_max_age_hours are marked abandoned.
 */
export async function reconcilePayments(deps: ReconciliationDeps): Promise<ReconciliationResult> {
  const { db, payments, confirmation, settings, logger } = deps;
  const [afterMinutes, maxAgeHours, batch] = await Promise.all([
    settings.getLimit(db, 'payments.reconcile_after_minutes'),
    settings.getLimit(db, 'payments.reconcile_max_age_hours'),
    settings.getLimit(db, 'payments.reconcile_batch'),
  ]);
  const abandoned = await payments.abandonStale(db, maxAgeHours);
  const references = await payments.leaseUnresolved(db, afterMinutes, maxAgeHours, batch);
  let resolved = 0;
  for (const reference of references) {
    try {
      const result = await confirmation.confirm(reference, 'reconcile');
      if (result && result.outcome !== 'pending') resolved += 1;
    } catch (err) {
      logger.error(
        { reference, err: err instanceof Error ? err.message : 'error' },
        'payment reconciliation failed (will retry)',
      );
    }
  }
  if (references.length > 0 || abandoned > 0) {
    logger.info({ checked: references.length, resolved, abandoned }, 'payment reconciliation run');
  }
  return { checked: references.length, resolved, abandoned };
}
