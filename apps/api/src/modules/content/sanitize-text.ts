import sanitizeHtml from 'sanitize-html';

/** Strip every tag (keep text); drop script/style contents entirely. */
const STRIP_ALL_HTML: sanitizeHtml.IOptions = { allowedTags: [], allowedAttributes: {} };
/** Entity-encoded tags (`&lt;script&gt;`) can nest; a few passes always reach a fixed point. */
const MAX_PASSES = 5;

/** sanitize-html escapes only these in text; reverse exactly those so Markdown stays readable. */
function decodeBasicEntities(text: string): string {
  return text.replace(/&(lt|gt|amp);/g, (_match, name: string) =>
    name === 'lt' ? '<' : name === 'gt' ? '>' : '&',
  );
}

/**
 * Content is stored as Markdown with NO raw HTML. Removes every HTML tag (including tags hidden
 * behind entities) while keeping ordinary characters such as `a < b` or `R&D` intact.
 * Assumption: clients render Markdown with raw HTML disabled (defence in depth).
 */
export function stripHtml(input: string): string {
  let current = input;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = decodeBasicEntities(sanitizeHtml(current, STRIP_ALL_HTML));
    if (next === current) return next;
    current = next;
  }
  // Still changing (pathological input): keep the escaped form, which is always safe.
  return sanitizeHtml(current, STRIP_ALL_HTML);
}

/** Sanitizes an optional field; empty results are stored as null. */
export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = stripHtml(value).trim();
  return cleaned === '' ? null : cleaned;
}
