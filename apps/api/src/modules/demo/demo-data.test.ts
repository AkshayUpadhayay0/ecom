/* eslint-disable @typescript-eslint/no-confusing-void-expression -- expect(() => fn()).toThrow() is the idiom */
import { describe, expect, it } from 'vitest';
import { DEMO, assertDemoSeedAllowed, planDemoProducts } from './demo-data.js';

const local = 'postgres://postgres:secret@localhost:5432/ecom';

describe('assertDemoSeedAllowed', () => {
  it('allows the local development database', () => {
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: 'development', databaseUrl: local }),
    ).not.toThrow();
    expect(() =>
      assertDemoSeedAllowed({ nodeEnv: undefined, databaseUrl: 'postgres://u:p@127.0.0.1/ecom' }),
    ).not.toThrow();
  });
  it('refuses production whatever the database', () => {
    expect(() => assertDemoSeedAllowed({ nodeEnv: 'production', databaseUrl: local })).toThrow(
      /production/,
    );
  });
  it('refuses any database other than the configured dev one (test, staging, typos)', () => {
    for (const name of ['ecom_test', 'ecom_prod', 'postgres', 'ecom2']) {
      expect(() =>
        assertDemoSeedAllowed({
          nodeEnv: 'development',
          databaseUrl: `postgres://u:p@localhost/${name}`,
        }),
      ).toThrow(/only runs on the development database/);
    }
  });
  it('lets DEMO_SEED_DATABASE name a differently named dev database', () => {
    const url = 'postgres://u:p@localhost/urban_dev';
    expect(() => assertDemoSeedAllowed({ nodeEnv: 'development', databaseUrl: url })).toThrow();
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnv: 'development',
        databaseUrl: url,
        allowedDatabase: 'urban_dev',
      }),
    ).not.toThrow();
  });
  it('refuses a database on another machine', () => {
    expect(() =>
      assertDemoSeedAllowed({
        nodeEnv: 'development',
        databaseUrl: 'postgres://u:p@db.example.com/ecom',
      }),
    ).toThrow(/local database/);
  });
  it('does not leak the password in its messages', () => {
    try {
      assertDemoSeedAllowed({
        nodeEnv: 'development',
        databaseUrl: 'postgres://u:hunter2@db.example.com/ecom',
      });
    } catch (error) {
      expect((error as Error).message).not.toContain('hunter2');
    }
  });
});

describe('planDemoProducts', () => {
  const plan = planDemoProducts();
  it('plans 24 uniquely named, clearly marked products', () => {
    expect(plan).toHaveLength(24);
    expect(plan[0]?.name).toBe('Demo outfit 01');
    expect(plan[23]?.name).toBe('Demo outfit 24');
    expect(new Set(plan.map((p) => p.slug)).size).toBe(24);
    expect(
      plan.every((p) => p.slug.startsWith(DEMO.slugPrefix) && p.name.startsWith(DEMO.namePrefix)),
    ).toBe(true);
  });
  it('mixes media: some videos, mostly photos, exactly one with none', () => {
    expect(plan.filter((p) => p.media === 'video').length).toBeGreaterThanOrEqual(3);
    expect(plan.filter((p) => p.media === 'photos').length).toBeGreaterThanOrEqual(10);
    expect(plan.filter((p) => p.media === 'none')).toHaveLength(1);
    expect(
      plan.filter((p) => p.media === 'photos').every((p) => p.photoCount >= 1 && p.photoCount <= 3),
    ).toBe(true);
  });
  it('has exactly one Blueprint product and it has a video', () => {
    const profile = plan.filter((p) => p.blueprint);
    expect(profile).toHaveLength(1);
    expect(profile[0]?.media).toBe('video');
    expect(profile[0]?.typeSlug).toBe('shirt');
  });
  it('covers in-stock, low-stock and sold-out, with whole-kobo sample prices', () => {
    expect(plan.some((p) => p.stock.every((units) => units === 0))).toBe(true);
    expect(plan.some((p) => p.stock.some((units) => units > 0 && units <= 2))).toBe(true);
    expect(plan.some((p) => p.stock.every((units) => units >= 3))).toBe(true);
    expect(plan.every((p) => Number.isInteger(p.priceMinor) && p.priceMinor >= 1_500_000)).toBe(
      true,
    );
  });
});
