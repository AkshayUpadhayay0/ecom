import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreDrafts, saveDrafts } from './drafts';

function page(html: string): void {
  document.body.innerHTML = `<main>${html}</main>`;
}

describe('language-switch drafts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('puts typed text, selects and radio choices back on the same page', () => {
    page(`
      <input name="quantity" value="3">
      <select name="zone"><option value="">-</option><option value="a">A</option></select>
      <input type="radio" name="size" value="m"><input type="radio" name="size" value="l">`);
    (document.querySelector('select') as HTMLSelectElement).value = 'a';
    (document.querySelector('input[value="l"]') as HTMLInputElement).checked = true;
    saveDrafts();

    // The new page renders with defaults.
    page(`
      <input name="quantity" value="1">
      <select name="zone"><option value="">-</option><option value="a">A</option></select>
      <input type="radio" name="size" value="m"><input type="radio" name="size" value="l">`);
    const stop = restoreDrafts();
    vi.advanceTimersByTime(300);
    stop();

    expect((document.querySelector('[name=quantity]') as HTMLInputElement).value).toBe('3');
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('a');
    expect((document.querySelector('input[value="l"]') as HTMLInputElement).checked).toBe(true);
    expect(sessionStorage.getItem('ui:form-drafts')).toBeNull();
  });

  it('never stores passwords or secret-looking fields', () => {
    page(
      `<input type="password" name="password" value="hunter2"><input name="newPassword" value="x"><input name="email" value="a@b.co">`,
    );
    saveDrafts();
    const stored = sessionStorage.getItem('ui:form-drafts') ?? '';
    expect(stored).not.toContain('hunter2');
    expect(stored).not.toContain('newPassword');
    expect(stored).toContain('a@b.co');
  });

  it('ignores a snapshot that is old or from another page', () => {
    page(`<input name="quantity" value="3">`);
    saveDrafts();
    vi.advanceTimersByTime(20_000);
    page(`<input name="quantity" value="1">`);
    restoreDrafts();
    vi.advanceTimersByTime(500);
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('1');
  });

  it('waits for a form that renders a moment later', () => {
    page(`<input name="city" value="Lagos">`);
    saveDrafts();
    page('');
    const stop = restoreDrafts();
    vi.advanceTimersByTime(300);
    page(`<input name="city" value="">`);
    vi.advanceTimersByTime(300);
    stop();
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('Lagos');
  });
});
