import { describe, expect, it } from 'vitest';
import { isPolicySlug, policyBlockKey, supportLinks } from './site-links';

describe('supportLinks', () => {
  it('shows nothing until the client supplied contact details', () => {
    expect(supportLinks({ email: null, phone: null, whatsapp: null })).toEqual([]);
  });

  it('builds mailto, tel and WhatsApp links from what was supplied, with the detail as text', () => {
    expect(
      supportLinks({
        email: 'hello@example.com',
        phone: '+234 801 234 5678',
        whatsapp: '+234 801 234 5678',
      }),
    ).toEqual([
      { href: 'mailto:hello@example.com', label: 'hello@example.com', external: true },
      { href: 'tel:+2348012345678', label: '+234 801 234 5678', external: true },
      { href: 'https://wa.me/2348012345678', label: '+234 801 234 5678', external: true },
    ]);
  });

  it('skips a phone or WhatsApp value with no digits', () => {
    expect(supportLinks({ email: null, phone: 'call us', whatsapp: '---' })).toEqual([]);
  });
});

describe('policy pages', () => {
  it('only the known policy slugs map to content blocks', () => {
    expect(isPolicySlug('privacy')).toBe(true);
    expect(isPolicySlug('returns')).toBe(true);
    expect(isPolicySlug('footer.about')).toBe(false);
    expect(isPolicySlug('../secret')).toBe(false);
    expect(policyBlockKey('terms')).toBe('policy.terms');
  });
});
