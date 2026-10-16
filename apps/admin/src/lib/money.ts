const KOBO_PER_NAIRA = 100;
const NAIRA_INPUT = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Parses a naira amount typed by an admin ("15000" or "15000.50") into kobo without floats.
 * Returns null when the text is not a valid amount.
 */
export function nairaToKobo(text: string): number | null {
  const value = text.trim().replaceAll(',', '');
  if (!NAIRA_INPUT.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * KOBO_PER_NAIRA + Number(fraction.padEnd(2, '0'));
}

/** Kobo -> "15000.50" for an input field. */
export function koboToNairaInput(kobo: number): string {
  const whole = Math.trunc(kobo / KOBO_PER_NAIRA);
  const fraction = kobo % KOBO_PER_NAIRA;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}
