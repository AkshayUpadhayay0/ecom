import type { MessageKey } from '@urban-ibile/i18n';

export type MeasurementParse =
  { ok: true; value: number } | { ok: false; error: MessageKey; params?: Record<string, number> };

/** Digits with one optional decimal separator: "42", "42.5", "42,5", ".5" are all fine shapes. */
const SHAPE = /^(\d+)?(?:[.,](\d*))?$/;

/**
 * Reads what the shopper typed into a measurement box (inches, at most one decimal). Both "." and
 * "," work as the decimal mark. The limits come from the API's requirements (sane input range, not
 * a size rule); the server validates again and decides the size.
 */
export function parseMeasurement(
  raw: string,
  limits: { min: number; max: number },
): MeasurementParse {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'fms.measure.error.required' };
  const match = SHAPE.exec(text);
  if (!match || (match[1] === undefined && (match[2] === undefined || match[2] === ''))) {
    return { ok: false, error: 'fms.measure.error.format' };
  }
  const decimals = match[2] ?? '';
  if (decimals.length > 1) return { ok: false, error: 'fms.measure.error.decimals' };
  const value = Number(`${match[1] ?? '0'}.${decimals === '' ? '0' : decimals}`);
  if (value <= 0) return { ok: false, error: 'fms.measure.error.format' };
  if (value < limits.min)
    return { ok: false, error: 'fms.measure.error.min', params: { min: limits.min } };
  if (value > limits.max)
    return { ok: false, error: 'fms.measure.error.max', params: { max: limits.max } };
  return { ok: true, value };
}

export interface RequirementLike {
  code: string;
  minInches: number;
  maxInches: number;
}

export type MeasurementErrors = Record<
  string,
  { error: MessageKey; params?: Record<string, number> }
>;

export type MeasurementsResult =
  { ok: true; values: Record<string, number> } | { ok: false; errors: MeasurementErrors };

/** Validates every required measurement; returns inches by code, or the errors per code. */
export function parseAllMeasurements(
  requirements: readonly RequirementLike[],
  texts: Readonly<Record<string, string>>,
): MeasurementsResult {
  const values: Record<string, number> = {};
  const errors: MeasurementErrors = {};
  for (const requirement of requirements) {
    const parsed = parseMeasurement(texts[requirement.code] ?? '', {
      min: requirement.minInches,
      max: requirement.maxInches,
    });
    if (parsed.ok) values[requirement.code] = parsed.value;
    else
      errors[requirement.code] = {
        error: parsed.error,
        ...(parsed.params ? { params: parsed.params } : {}),
      };
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values };
}
