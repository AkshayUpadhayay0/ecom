/**
 * Button classes (plain strings, usable from server and client components).
 * Primary = brand Red with white text. White on Red is 4.04:1, which is only allowed for LARGE
 * text, so the text is 19 px (1.1875rem) bold or larger: button-classes.test.ts enforces it.
 */
export const primaryButtonClass =
  'inline-flex min-h-12 items-center justify-center bg-red px-6 py-2 text-[1.1875rem] font-bold text-white disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center border border-ink px-5 py-2 text-base disabled:cursor-not-allowed disabled:opacity-60';
