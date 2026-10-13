import type {
  ApiData,
  ApiList,
  ContentBlockDto,
  ContentBlockSummaryDto,
} from '@urban-ibile/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adminClient,
  auditCount,
  errorCode,
  insertMediaAsset,
  resetAdminApiData,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestApp,
  makeTestEnv,
  testDatabaseUrl,
  type TestContext,
} from '../../../test/helpers.js';

const HERO = 'home.hero';

interface TranslationSnapshot {
  content_block_id: string;
  language_code: string;
  title: string | null;
  body: string | null;
  cta_label: string | null;
}

describe.skipIf(!hasTestDatabase)('admin content blocks API', () => {
  let ctx: TestContext;
  let api: AdminClient;
  let original: { translations: TranslationSnapshot[]; published: Map<string, boolean> };

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    ctx = makeTestApp(makeTestEnv({ RATE_LIMIT_MAX: '100000' }));
    original = {
      translations: await ctx.db.selectFrom('content_block_translations').selectAll().execute(),
      published: new Map(
        (await ctx.db.selectFrom('content_blocks').select(['id', 'is_published']).execute()).map(
          (row) => [row.id, row.is_published],
        ),
      ),
    };
  });

  async function restoreContent(): Promise<void> {
    await ctx.db.deleteFrom('content_block_translations').execute();
    if (original.translations.length > 0) {
      await ctx.db.insertInto('content_block_translations').values(original.translations).execute();
    }
    for (const [id, isPublished] of original.published) {
      await ctx.db
        .updateTable('content_blocks')
        .set({ is_published: isPublished })
        .where('id', '=', id)
        .execute();
    }
  }

  beforeEach(async () => {
    await resetAdminApiData(ctx);
    await restoreContent();
    api = adminClient(ctx, (await signInAdmin(ctx)).token);
  });

  afterAll(async () => {
    await resetAdminApiData(ctx);
    await restoreContent();
    await ctx.db.destroy();
  });

  it('lists blocks (no hidden pages) and returns one with its (read-only) text', async () => {
    const list = bodyOf<ApiList<ContentBlockSummaryDto>>(await api.get('/content-blocks'));
    expect(list.data.map((b) => b.key)).toContain(HERO);
    expect(list.data.some((b) => b.key.startsWith('qr'))).toBe(false);

    const hero = bodyOf<ApiData<ContentBlockDto>>(await api.get(`/content-blocks/${HERO}`)).data;
    expect(hero.translations.en).toBeDefined();
    expect((await api.get('/content-blocks/does.not.exist')).status).toBe(404);
  });

  it('has no admin text/translation editing (static copy is developer-managed)', async () => {
    const res = await api.put(`/content-blocks/${HERO}/translations/pcm`, { title: 'New' });
    expect(res.status).toBe(404);
    const unchanged = await ctx.db
      .selectFrom('content_block_translations')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(unchanged.n)).toBe(original.translations.length);
  });

  it('publishes / unpublishes and sets the hero video to a READY, PUBLIC asset only', async () => {
    const unpublished = await api.post(`/content-blocks/${HERO}/unpublish`);
    expect(bodyOf<ApiData<ContentBlockDto>>(unpublished).data.isPublished).toBe(false);
    const published = await api.post(`/content-blocks/${HERO}/publish`);
    expect(bodyOf<ApiData<ContentBlockDto>>(published).data.isPublished).toBe(true);

    const pending = await insertMediaAsset(ctx, { kind: 'video', status: 'pending' });
    const notReady = await api.put(`/content-blocks/${HERO}/media`, { mediaAssetId: pending });
    expect(errorCode(notReady)).toBe('MEDIA_NOT_READY');

    const privateVideo = await insertMediaAsset(ctx, {
      kind: 'video',
      status: 'ready',
      visibility: 'private',
    });
    const hidden = await api.put(`/content-blocks/${HERO}/media`, { mediaAssetId: privateVideo });
    expect(hidden.status).toBe(404);

    const ready = await insertMediaAsset(ctx, { kind: 'video', status: 'ready' });
    const set = await api.put(`/content-blocks/${HERO}/media`, { mediaAssetId: ready });
    expect(bodyOf<ApiData<ContentBlockDto>>(set).data.mediaAssetId).toBe(ready);
    const cleared = await api.put(`/content-blocks/${HERO}/media`, { mediaAssetId: null });
    expect(bodyOf<ApiData<ContentBlockDto>>(cleared).data.mediaAssetId).toBeNull();

    expect(await auditCount(ctx, { action: 'content_block.publish', entityId: HERO })).toBe(1);
    expect(await auditCount(ctx, { action: 'content_block.unpublish', entityId: HERO })).toBe(1);
    expect(await auditCount(ctx, { action: 'content_block.media_replace', entityId: HERO })).toBe(
      2,
    );
  });
});
