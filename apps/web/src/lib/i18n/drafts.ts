/**
 * Keeps what the shopper has typed or picked while the language changes. Switching language
 * re-renders the page in the other language (a different route segment), which would otherwise
 * reset the page's forms. The values are held in sessionStorage for a few seconds and put back
 * when the new page appears. Passwords and other secrets are never stored.
 */
const STORAGE_KEY = 'ui:form-drafts';
const MAX_AGE_MS = 15_000;
const RETRY_MS = 150;
const MAX_ATTEMPTS = 14;
const FIELD_SELECTOR = 'main input, main select, main textarea';
const SKIPPED_TYPES = new Set(['password', 'hidden', 'file', 'submit', 'button']);

interface Draft {
  key: string;
  type: string;
  value: string;
  checked: boolean;
}

interface Snapshot {
  path: string;
  at: number;
  fields: Draft[];
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function keyOf(field: Field): string | null {
  const name = field.getAttribute('name');
  if (!name || /pass|token|secret|card/i.test(name)) return null;
  const type = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
  // Radios and checkboxes of one group share a name: include the value to tell them apart.
  return type === 'radio' || type === 'checkbox'
    ? `${name}=${field.getAttribute('value') ?? ''}`
    : name;
}

export function saveDrafts(): void {
  try {
    const fields: Draft[] = [];
    for (const field of document.querySelectorAll<Field>(FIELD_SELECTOR)) {
      const type = field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase();
      if (SKIPPED_TYPES.has(type)) continue;
      const key = keyOf(field);
      if (!key) continue;
      const checked = field instanceof HTMLInputElement ? field.checked : false;
      fields.push({ key, type, value: field.value, checked });
    }
    const snapshot: Snapshot = {
      path: `${location.pathname}${location.search}`,
      at: Date.now(),
      fields,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage unavailable (private mode): the page simply starts fresh.
  }
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Snapshot;
    const fresh = Date.now() - snapshot.at < MAX_AGE_MS;
    const samePage = snapshot.path === `${location.pathname}${location.search}`;
    return fresh && samePage ? snapshot : null;
  } catch {
    return null;
  }
}

function setNativeValue(field: Field, value: string): void {
  const prototype = Object.getPrototypeOf(field) as object;
  // The native setter is invoked with .call(field) below, so it is not unbound.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Puts the saved values back. Returns true when every saved field was found and restored. */
function applySnapshot(snapshot: Snapshot): boolean {
  const byKey = new Map<string, Field>();
  for (const field of document.querySelectorAll<Field>(FIELD_SELECTOR)) {
    const key = keyOf(field);
    if (key) byKey.set(key, field);
  }
  let complete = true;
  for (const draft of snapshot.fields) {
    const field = byKey.get(draft.key);
    if (!field) {
      complete = false;
      continue;
    }
    if (
      field instanceof HTMLInputElement &&
      (field.type === 'radio' || field.type === 'checkbox')
    ) {
      if (draft.checked !== field.checked && !field.disabled) field.click();
    } else if (field.value !== draft.value) {
      setNativeValue(field, draft.value);
    }
  }
  return complete;
}

/**
 * Restores a fresh snapshot made by saveDrafts() on this same page. Forms that render a moment
 * later (after their data loads) are retried briefly. Returns a cancel function.
 */
export function restoreDrafts(): () => void {
  const snapshot = readSnapshot();
  if (!snapshot) return () => undefined;
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (applySnapshot(snapshot) || attempts >= MAX_ATTEMPTS) {
      clearInterval(timer);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, RETRY_MS);
  return () => {
    clearInterval(timer);
  };
}
