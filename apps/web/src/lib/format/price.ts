const LOCALE = 'en-NG';
const MINOR_UNITS_PER_MAJOR = 100;
const DEFAULT_CURRENCY = 'NGN';

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Formats integer minor units (kobo) for display, e.g. 3500000 -> "₦35,000". Uses Intl with
 * en-NG; whole amounts hide the decimals, fractional amounts keep two. The input is never a float.
 */
export function formatPrice(minor: number, currency: string = DEFAULT_CURRENCY): string {
  const whole = minor % MINOR_UNITS_PER_MAJOR === 0;
  const key = `${currency}:${whole}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(minor / MINOR_UNITS_PER_MAJOR);
}

/** Major-unit string for structured data ("35000.00"): computed from integers, not floats. */
export function majorUnitsString(minor: number): string {
  const major = Math.trunc(minor / MINOR_UNITS_PER_MAJOR);
  const rest = Math.abs(minor % MINOR_UNITS_PER_MAJOR);
  return `${major}.${String(rest).padStart(2, '0')}`;
}
