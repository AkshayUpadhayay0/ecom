import type { BodyScanSessionDto } from '@urban-ibile/shared';
import type { Logger } from 'pino';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import type { BlueprintRepository } from '../blueprint/blueprint.repository.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { BodyScanProvider, ScanResult } from './body-scan-provider.js';
import type { BodyScanRepository, BodyScanRow } from './body-scan.repository.js';

const MS_PER_MINUTE = 60_000;
const EXPIRED_REASON = 'Session expired before a result arrived.';

export interface BodyScanService {
  readonly available: boolean;
  readonly mocked: boolean;
  /** Starts a session for a product that uses Blueprint. */
  create(customerId: string, productId: string): Promise<BodyScanSessionDto>;
  /** Own session only; polls the provider while in progress. */
  get(customerId: string, id: string): Promise<BodyScanSessionDto>;
  /** Provider callback. Returns false when the provider or signature is not recognised. */
  handleWebhook(
    providerName: string,
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<boolean>;
  /** Measurements of a COMPLETED session owned by the customer for this product. */
  completedMeasurements(
    customerId: string,
    sessionId: string,
    productId: string,
  ): Promise<Record<string, number>>;
}

export interface BodyScanServiceDeps {
  db: Database;
  repository: BodyScanRepository;
  blueprint: BlueprintRepository;
  settings: SettingsService;
  /** null when BODY_SCAN_PROVIDER=none. */
  provider: BodyScanProvider | null;
  logger: Logger;
}

function unavailable(): AppError {
  return new AppError(
    'BODY_SCAN_UNAVAILABLE',
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    'Body Scan is not available right now.',
  );
}

/** Only finite positive numbers survive; anything else from a provider is dropped. */
function cleanMeasurements(value: unknown): Record<string, number> {
  if (value === null || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] > 0,
    ),
  );
}

export function createBodyScanService(deps: BodyScanServiceDeps): BodyScanService {
  const { db, repository, provider, logger } = deps;

  function toDto(row: BodyScanRow, captureUrl: string | null = null): BodyScanSessionDto {
    return {
      id: row.id,
      productId: row.productId,
      status: row.status,
      provider: row.provider,
      mocked: provider?.mocked ?? false,
      captureUrl,
      measurements: row.status === 'COMPLETED' ? cleanMeasurements(row.resultMeasurements) : null,
      failureReason: row.failureReason,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  async function requiredCodes(productId: string): Promise<string[]> {
    const product = await deps.blueprint.findFittingProduct(db, productId);
    if (!product) throw notFoundError('Product');
    if (product.profileId === null) {
      throw new AppError(
        'BLUEPRINT_NOT_APPLICABLE',
        HTTP_STATUS.CONFLICT,
        'This product does not use Blueprint sizing.',
      );
    }
    const items = await deps.blueprint.profileItems(db, product.profileId);
    return [...new Set(items.map((item) => item.measurementCode))];
  }

  async function apply(row: BodyScanRow, result: ScanResult): Promise<BodyScanRow> {
    if (row.status === 'COMPLETED' || row.status === 'FAILED') return row; // finished: immutable
    if (result.status === 'COMPLETED') {
      return repository.markCompleted(db, row.id, cleanMeasurements(result.measurements));
    }
    if (result.status === 'FAILED') {
      return repository.markFailed(db, row.id, result.failureReason ?? 'Scan failed.');
    }
    return row;
  }

  return {
    available: provider !== null,
    mocked: provider?.mocked ?? false,

    async create(customerId, productId) {
      if (!provider) throw unavailable();
      const codes = await requiredCodes(productId);
      const ttl = await deps.settings.getLimit(db, 'body_scan.session_ttl_minutes');
      const created = await repository.create(db, {
        customerId,
        productId,
        provider: provider.name,
        expiresAt: new Date(Date.now() + ttl * MS_PER_MINUTE),
      });
      const started = await provider.startSession({
        sessionId: created.id,
        measurementCodes: codes,
      });
      if (provider.mocked)
        logger.warn(
          { bodyScanSessionId: created.id },
          'body scan session started with the MOCKED provider',
        );
      return toDto(
        await repository.markStarted(db, created.id, started.externalRef),
        started.captureUrl,
      );
    },

    async get(customerId, id) {
      let row = await repository.findOwned(db, id, customerId);
      if (!row) throw notFoundError('Body scan session');
      if (row.status !== 'IN_PROGRESS' || !provider || row.externalRef === null) return toDto(row);
      if (row.expiresAt !== null && row.expiresAt < new Date()) {
        return toDto(await repository.markFailed(db, row.id, EXPIRED_REASON));
      }
      const codes = await requiredCodes(row.productId);
      row = await apply(row, await provider.fetchResult(row.externalRef, codes));
      return toDto(row);
    },

    async handleWebhook(providerName, rawBody, signature) {
      if (!provider || provider.name !== providerName) return false;
      const parsed = provider.parseWebhook(rawBody, signature);
      if (!parsed) return false;
      const row = await repository.findByExternalRef(db, provider.name, parsed.externalRef);
      if (row) await apply(row, parsed.result);
      return true; // unknown sessions are acknowledged (no retry storm) but change nothing
    },

    async completedMeasurements(customerId, sessionId, productId) {
      const row = await repository.findOwned(db, sessionId, customerId);
      if (!row || row.productId !== productId || row.status !== 'COMPLETED') {
        throw new AppError(
          'BODY_SCAN_NOT_READY',
          HTTP_STATUS.CONFLICT,
          'The Body Scan for this product is not complete.',
          { status: row?.productId === productId ? row.status : null },
        );
      }
      return cleanMeasurements(row.resultMeasurements);
    },
  };
}
