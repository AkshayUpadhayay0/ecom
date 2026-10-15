import {
  BOUNDARY_RULE,
  MEASUREMENT_UNIT,
  type BlueprintRequirementsDto,
  type DecisionDto,
  type DecisionRequest,
  type ListDecisionsQuery,
  type MeasurementLimits,
  type MeasurementRequirementDto,
  type RecommendationDto,
  type RecommendationRequest,
  type SizeAlternativeDto,
} from '@urban-ibile/shared';
import type { Database } from '../../db/database.js';
import { AppError, notFoundError } from '../../lib/errors.js';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { toPageMeta, toPageRequest, type Page } from '../../lib/pagination.js';
import type { BodyScanService } from '../body-scan/body-scan.service.js';
import { availabilityOf } from '../catalog/public-catalog.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import {
  recommendSize,
  type BreakdownEntry,
  type EngineItem,
  type SizePick,
} from './blueprint-engine.js';
import { toDecisionDto, toSizeRef } from './blueprint.dto.js';
import type {
  BlueprintRepository,
  FittingProductRow,
  ProductSizeRow,
  ProfileItemRow,
} from './blueprint.repository.js';

/** Neutral wording while the client decides what customers may do out of range. */
export const OUT_OF_RANGE_MESSAGE = 'We could not match this measurement to our size chart.';
const TENTHS = 10;
const DECIMAL_TOLERANCE = 1e-9;

export interface BlueprintService {
  requirements(productId: string): Promise<BlueprintRequirementsDto>;
  /** Preview: computes the size, saves nothing, reserves nothing. */
  recommend(customerId: string, input: RecommendationRequest): Promise<RecommendationDto>;
  /** Recomputes server-side and stores ONE append-only decision with its measurements. */
  decide(customerId: string, input: DecisionRequest): Promise<DecisionDto>;
  getDecision(customerId: string, id: string): Promise<DecisionDto>;
  listDecisions(customerId: string, query: ListDecisionsQuery): Promise<Page<DecisionDto>>;
}

export interface BlueprintServiceDeps {
  db: Database;
  repository: BlueprintRepository;
  settings: SettingsService;
  bodyScan: BodyScanService;
}

interface Computation {
  product: FittingProductRow & { profileId: string };
  items: (ProfileItemRow & { chartId: string; chartVersion: number })[];
  recommended: SizePick;
  breakdown: BreakdownEntry[];
  sizes: ProductSizeRow[];
  boundaryRules: string[];
}

interface Issue {
  path: string;
  message: string;
}

function invalidMeasurements(issues: Issue[]): AppError {
  return new AppError(
    'BLUEPRINT_MEASUREMENTS_INVALID',
    HTTP_STATUS.BAD_REQUEST,
    'Some measurements are missing or invalid.',
    { issues },
  );
}

function limitsFor(limits: MeasurementLimits, code: string): { min: number; max: number } {
  return limits.byMeasurement[code] ?? limits.default;
}

/** One decimal place at most (charts store numeric(5,1); values must round-trip exactly). */
function hasOneDecimalAtMost(value: number): boolean {
  return Math.abs(value * TENTHS - Math.round(value * TENTHS)) < DECIMAL_TOLERANCE;
}

export function createBlueprintService(deps: BlueprintServiceDeps): BlueprintService {
  const { db, repository, settings, bodyScan } = deps;

  async function loadProduct(
    productId: string,
  ): Promise<FittingProductRow & { profileId: string }> {
    const product = await repository.findFittingProduct(db, productId);
    if (!product) throw notFoundError('Product');
    if (product.profileId === null) {
      throw new AppError(
        'BLUEPRINT_NOT_APPLICABLE',
        HTTP_STATUS.CONFLICT,
        'This product does not use Blueprint sizing; choose a size directly.',
      );
    }
    return { ...product, profileId: product.profileId };
  }

  async function loadItems(profileId: string): Promise<Computation['items']> {
    const items = await repository.profileItems(db, profileId);
    const missing = items.filter((item) => item.chartId === null || item.chartVersion === null);
    if (items.length === 0 || missing.length > 0) {
      throw new AppError(
        'BLUEPRINT_CHART_UNAVAILABLE',
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Sizing for this product is not available right now.',
        { chartGroups: [...new Set(missing.map((item) => item.chartGroupCode))] },
      );
    }
    return items.map((item) => ({
      ...item,
      chartId: item.chartId ?? '',
      chartVersion: item.chartVersion ?? 0,
    }));
  }

  async function assertFitPreference(code: string): Promise<void> {
    const options = await repository.activeFitPreferences(db);
    if (!options.some((option) => option.code === code)) {
      throw new AppError(
        'VALIDATION_ERROR',
        HTTP_STATUS.BAD_REQUEST,
        'Request validation failed.',
        {
          issues: [
            {
              path: 'fitPreference',
              message: `Use one of: ${options.map((o) => o.code).join(', ')}`,
            },
          ],
        },
      );
    }
  }

  /** Exact required set (no missing, no extra), numeric, <= 1 decimal, inside the sane limits. */
  async function validateValues(
    codes: readonly string[],
    raw: Record<string, number>,
    strictExtras: boolean,
  ): Promise<Map<string, number>> {
    const limits = await settings.getSetting(db, 'blueprint.measurement_limits');
    const issues: Issue[] = [];
    const values = new Map<string, number>();
    for (const code of codes) {
      const value = raw[code];
      const range = limitsFor(limits, code);
      if (value === undefined) issues.push({ path: `measurements.${code}`, message: 'Required.' });
      else if (!Number.isFinite(value) || value <= 0)
        issues.push({
          path: `measurements.${code}`,
          message: 'Must be a positive number of inches.',
        });
      else if (!hasOneDecimalAtMost(value))
        issues.push({ path: `measurements.${code}`, message: 'Use at most one decimal place.' });
      else if (value < range.min || value > range.max) {
        issues.push({
          path: `measurements.${code}`,
          message: `Must be between ${range.min} and ${range.max} inches.`,
        });
      } else values.set(code, value);
    }
    if (strictExtras) {
      for (const code of Object.keys(raw)) {
        if (!codes.includes(code))
          issues.push({ path: `measurements.${code}`, message: 'Not used for this product.' });
      }
    }
    if (issues.length > 0) throw invalidMeasurements(issues);
    return values;
  }

  async function compute(customerId: string, input: RecommendationRequest): Promise<Computation> {
    const product = await loadProduct(input.productId);
    await assertFitPreference(input.fitPreference);
    const items = await loadItems(product.profileId);
    const codes = [...new Set(items.map((item) => item.measurementCode))];

    const raw =
      input.method === 'BODY_SCAN'
        ? await bodyScan.completedMeasurements(
            customerId,
            input.bodyScanSessionId ?? '',
            product.id,
          )
        : (input.measurements ?? {});
    // Body Scan providers may return more measurements than this product needs; ignore extras.
    const values = await validateValues(codes, raw, input.method === 'MANUAL_MEASUREMENTS');

    const rows = await repository.chartRows(db, [...new Set(items.map((item) => item.chartId))]);
    const engineItems: EngineItem[] = items.map((item) => ({
      measurementCode: item.measurementCode,
      label: item.measurementLabel,
      chartId: item.chartId,
      chartGroup: item.chartGroupCode,
      chartVersion: item.chartVersion,
      rows: rows
        .filter(
          (row) => row.chartId === item.chartId && row.measurementTypeId === item.measurementTypeId,
        )
        .map((row) => ({
          sizeId: row.sizeId,
          sizeCode: row.sizeCode,
          sizeLabel: row.sizeLabel,
          sortOrder: row.sortOrder,
          minInches: Number(row.minInches),
          maxInches: Number(row.maxInches),
        })),
    }));
    const result = recommendSize({
      items: engineItems,
      values,
      rejectBelowChartMin: await settings.getSetting(db, 'blueprint.reject_below_chart_min'),
    });
    if (!result.ok) {
      // No decision is created and no size is guessed (OUT_OF_RANGE_POLICY = REJECT).
      throw new AppError(
        'BLUEPRINT_OUT_OF_RANGE',
        HTTP_STATUS.UNPROCESSABLE_ENTITY,
        OUT_OF_RANGE_MESSAGE,
        {
          measurements: result.outOfRange.map((entry) => ({
            code: entry.measurementCode,
            label: entry.label,
            valueInches: entry.valueInches,
            side: entry.side,
          })),
        },
      );
    }
    return {
      product,
      items,
      recommended: result.recommended,
      breakdown: result.breakdown,
      sizes: await repository.productSizes(db, product.id),
      boundaryRules: [...new Set(items.map((item) => item.boundaryRule ?? BOUNDARY_RULE))],
    };
  }

  function breakdownDto(entries: readonly BreakdownEntry[]) {
    return entries.map((entry) => ({
      code: entry.measurementCode,
      label: entry.label,
      valueInches: entry.valueInches,
      chart: { id: entry.chartId, group: entry.chartGroup, version: entry.chartVersion },
      requiredSize: {
        id: entry.required.sizeId,
        code: entry.required.sizeCode,
        label: entry.required.sizeLabel,
      },
    }));
  }

  async function loadDecision(customerId: string, id: string): Promise<DecisionDto> {
    const row = await repository.findDecision(db, id, customerId);
    // Someone else's decision looks exactly like a missing one.
    if (!row) throw notFoundError('Fitting decision');
    return toDecisionDto(row, await repository.decisionMeasurements(db, [row.id]));
  }

  return {
    async requirements(productId) {
      const product = await repository.findFittingProduct(db, productId);
      if (!product) throw notFoundError('Product');
      const fitOptions = await repository.activeFitPreferences(db);
      const base: Pick<BlueprintRequirementsDto, 'productId' | 'unit' | 'fitOptions' | 'bodyScan'> =
        {
          productId: product.id,
          unit: MEASUREMENT_UNIT,
          fitOptions,
          bodyScan: { available: bodyScan.available, mocked: bodyScan.mocked },
        };
      if (product.profileId === null) {
        return { ...base, required: false, profile: null, measurements: [] };
      }
      const limits = await settings.getSetting(db, 'blueprint.measurement_limits');
      const items = await repository.profileItems(db, product.profileId);
      // A measurement shared by two chart groups is asked for once.
      const unique = [...new Map(items.map((item) => [item.measurementCode, item])).values()];
      const measurements = unique.map((item): MeasurementRequirementDto => {
        const range = limitsFor(limits, item.measurementCode);
        return {
          code: item.measurementCode,
          label: item.measurementLabel,
          helpText: item.helpText,
          unit: MEASUREMENT_UNIT,
          minInches: range.min,
          maxInches: range.max,
        };
      });
      return {
        ...base,
        required: true,
        profile: { code: product.profileCode ?? '', name: product.profileName ?? '' },
        measurements,
      };
    },

    async recommend(customerId, input) {
      const result = await compute(customerId, input);
      const offered = result.sizes.find((size) => size.sizeId === result.recommended.sizeId);
      const alternatives: SizeAlternativeDto[] = result.sizes.map((size) => ({
        id: size.sizeId,
        code: size.sizeCode,
        label: size.sizeLabel,
        availability: availabilityOf(size),
      }));
      return {
        productId: result.product.id,
        method: input.method,
        fitPreference: input.fitPreference,
        recommendedSize: toSizeRef(result.recommended),
        recommendedOffered: offered !== undefined,
        recommendedInStock: offered !== undefined && offered.available > 0,
        breakdown: breakdownDto(result.breakdown),
        alternatives,
        boundaryRule: result.boundaryRules.join(','),
        mocked: input.method === 'BODY_SCAN' && bodyScan.mocked,
      };
    },

    async decide(customerId, input) {
      const result = await compute(customerId, input);
      const recommendedId = result.recommended.sizeId;
      let selectedId = recommendedId;
      if (input.selectionMode === 'LOCKED_RECOMMENDATION') {
        if (input.chosenSizeId !== undefined && input.chosenSizeId !== recommendedId) {
          throw new AppError(
            'INVALID_SIZE',
            HTTP_STATUS.CONFLICT,
            'A locked recommendation must use the recommended size. Choose OVERRIDE to pick another size.',
          );
        }
      } else {
        if (input.chosenSizeId === undefined) {
          throw new AppError(
            'VALIDATION_ERROR',
            HTTP_STATUS.BAD_REQUEST,
            'Request validation failed.',
            {
              issues: [{ path: 'chosenSizeId', message: 'Required for OVERRIDE.' }],
            },
          );
        }
        if (!result.sizes.some((size) => size.sizeId === input.chosenSizeId)) {
          throw new AppError(
            'INVALID_SIZE',
            HTTP_STATUS.CONFLICT,
            'This product is not offered in the chosen size.',
          );
        }
        if (input.chosenSizeId === recommendedId) {
          throw new AppError(
            'INVALID_SIZE',
            HTTP_STATUS.CONFLICT,
            'That is the recommended size. Use LOCKED_RECOMMENDATION to accept it.',
          );
        }
        selectedId = input.chosenSizeId;
      }

      const selected = result.sizes.find((size) => size.sizeId === selectedId);
      const chartSnapshot = {
        boundaryRule: result.boundaryRules.join(','),
        charts: [...new Map(result.breakdown.map((b) => [b.chartId, b])).values()].map((b) => ({
          chartId: b.chartId,
          group: b.chartGroup,
          version: b.chartVersion,
        })),
        recommended: { code: result.recommended.sizeCode, sortOrder: result.recommended.sortOrder },
        selected: { code: selected?.sizeCode ?? result.recommended.sizeCode },
        fitPreference: input.fitPreference,
        measurements: result.breakdown.map((b) => ({
          code: b.measurementCode,
          valueInches: b.valueInches,
          requiredSize: b.required.sizeCode,
        })),
      };
      const typeIdByCode = new Map(
        result.items.map((item) => [
          `${item.chartId}|${item.measurementCode}`,
          item.measurementTypeId,
        ]),
      );

      // One transaction; the DB re-checks completeness and the largest-size rule at COMMIT.
      const id = await db.transaction().execute(async (trx) => {
        const decisionId = await repository.insertDecision(trx, {
          customerId,
          productId: result.product.id,
          measurementProfileId: result.product.profileId,
          method: input.method,
          bodyScanSessionId:
            input.method === 'BODY_SCAN' ? (input.bodyScanSessionId ?? null) : null,
          fitPreference: input.fitPreference,
          recommendedSizeId: recommendedId,
          selectedSizeId: selectedId,
          selectionMode: input.selectionMode,
          chartSnapshot,
        });
        await repository.insertMeasurements(
          trx,
          decisionId,
          result.breakdown.map((b) => ({
            chartId: b.chartId,
            measurementTypeId: typeIdByCode.get(`${b.chartId}|${b.measurementCode}`) ?? '',
            valueInches: b.valueInches,
            requiredSizeId: b.required.sizeId,
          })),
        );
        return decisionId;
      });
      return loadDecision(customerId, id);
    },

    getDecision: loadDecision,

    async listDecisions(customerId, query) {
      const page = toPageRequest(query, await settings.getLimit(db, 'catalog.page_size'));
      const { rows, total } = await repository.listDecisions(
        db,
        customerId,
        { productId: query.productId },
        page,
      );
      const measurements = await repository.decisionMeasurements(
        db,
        rows.map((row) => row.id),
      );
      return {
        items: rows.map((row) =>
          toDecisionDto(
            row,
            measurements.filter((m) => m.decisionId === row.id),
          ),
        ),
        meta: toPageMeta(page, total),
      };
    },
  };
}
