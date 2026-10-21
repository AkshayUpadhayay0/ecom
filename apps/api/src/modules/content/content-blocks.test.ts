import type {
  ApiData,
  ApiList,
  ContentBlockDto,
  ContentBlockSummaryDto,
  PublicContentBlockDto,
} from '@urban-ibile/shared';
import request from 'supertest';
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

  describe('editor by content type (20 Oct 2026)', () => {
    const TERMS = 'policy.terms';
    const site = (key: string) => request(ctx.app).get(`/api/v1/site/content/${key}`);

    it('knows which blocks are video (hero) and which are text, and which text is pending', async () => {
      const list = bodyOf<ApiList<ContentBlockSummaryDto>>(await api.get('/content-blocks')).data;
      const byKey = new Map(list.map((b) => [b.key, b]));
      expect(byKey.get(HERO)).toMatchObject({ kind: 'video', pending: false });
      for (const key of ['footer.about', 'policy.privacy', 'policy.terms', 'policy.returns']) {
        // Seed placeholders were turned into "pending client content" (no copy invented).
        expect(byKey.get(key), key).toMatchObject({ kind: 'text', pending: true });
      }
    });

    it('saves plain English text for a text block (audited); the public API shows it as plain parts', async () => {
      const pending = bodyOf<{ data: PublicContentBlockDto }>(await site(TERMS)).data;
      expect(pending).toMatchObject({ key: TERMS, status: 'pending', title: null, parts: [] });

      const body = [
        '# Using this site',
        'By shopping you agree.',
        'Second line.',
        '',
        'Payments are in naira.',
      ].join('\n');
      const saved = await api.put(`/content-blocks/${TERMS}/text`, { title: 'Terms', body });
      expect(saved.status).toBe(200);
      expect(bodyOf<ApiData<ContentBlockDto>>(saved).data).toMatchObject({
        kind: 'text',
        pending: false,
        translations: { en: { title: 'Terms', body } },
      });
      expect(await auditCount(ctx, { action: 'content_block.text_update', entityId: TERMS })).toBe(
        1,
      );

      const shown = bodyOf<{ data: PublicContentBlockDto }>(await site(TERMS)).data;
      expect(shown).toMatchObject({
        status: 'available',
        title: 'Terms',
        parts: [
          { type: 'heading', text: 'Using this site' },
          { type: 'paragraph', text: ['By shopping you agree.', 'Second line.'].join('\n') },
          { type: 'paragraph', text: 'Payments are in naira.' },
        ],
      });
      // No Pidgin / other language row was created by the editor.
      const languages = await ctx.db
        .selectFrom('content_block_translations as t')
        .innerJoin('content_blocks as b', 'b.id', 't.content_block_id')
        .select('t.language_code')
        .where('b.block_key', '=', TERMS)
        .execute();
      expect(languages.map((l) => l.language_code)).toEqual(['en']);
    });

    it('validates: required, length limits, no HTML, strict body', async () => {
      const put = (body: object) => api.put(`/content-blocks/${TERMS}/text`, body);
      expect((await put({ title: '', body: 'x' })).status).toBe(400);
      expect((await put({ title: 'T', body: '   ' })).status).toBe(400);
      expect((await put({ title: 'T', body: 'x'.repeat(20_001) })).status).toBe(400);
      expect((await put({ title: 'x'.repeat(201), body: 'x' })).status).toBe(400);
      const html = await put({ title: 'T', body: 'Hello <script>alert(1)</script>' });
      expect(html.status).toBe(400);
      expect(JSON.stringify(bodyOf<unknown>(html))).toMatch(/plain text/);
      expect((await put({ title: '<b>T</b>', body: 'x' })).status).toBe(400);
      expect((await put({ title: 'T', body: 'x', language: 'pcm' })).status).toBe(400);
      // Text that merely mentions < and > is fine.
      expect((await put({ title: 'T', body: 'Sizes 1 < 2 and 3 > 2' })).status).toBe(200);
    });

    it('keeps the editors apart: no video on text blocks, no text on the hero', async () => {
      const video = await insertMediaAsset(ctx, { kind: 'video', status: 'ready' });
      const onText = await api.put(`/content-blocks/${TERMS}/media`, { mediaAssetId: video });
      expect(onText.status).toBe(409);
      const onHero = await api.put(`/content-blocks/${HERO}/text`, { title: 'T', body: 'x' });
      expect(onHero.status).toBe(409);
      expect(errorCode(onHero)).toBe('INVALID_STATE');
      // The hero keeps working as before.
      expect((await api.put(`/content-blocks/${HERO}/media`, { mediaAssetId: video })).status).toBe(
        200,
      );
    });

    it('draft / publish: an unpublished text block is not public; the hero is not a text block', async () => {
      await api.put(`/content-blocks/${TERMS}/text`, { title: 'Terms', body: 'Text.' });
      expect((await api.post(`/content-blocks/${TERMS}/unpublish`)).status).toBe(200);
      expect((await site(TERMS)).status).toBe(404);
      expect((await api.post(`/content-blocks/${TERMS}/publish`)).status).toBe(200);
      expect((await site(TERMS)).status).toBe(200);
      expect((await site(HERO)).status).toBe(404);
      expect((await site('qr.page-one')).status).toBe(404);
    });

    it('is open to the client admin role (Content is a client page)', async () => {
      const admin = adminClient(ctx, (await signInAdmin(ctx, 'admin')).token);
      expect(
        (await admin.put(`/content-blocks/${TERMS}/text`, { title: 'T', body: 'x' })).status,
      ).toBe(200);
      expect(
        (await request(ctx.app).put(`/api/v1/admin/content-blocks/${TERMS}/text`)).status,
      ).toBe(401);
    });
  });

  describe('reset a text block to its seeded default (follow-up 3, 21 Oct 2026)', () => {
    const FOOTER = 'footer.about';

    it('restores "Pending client content" and the default published state, audited', async () => {
      const superApi = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
      // A tester edited and unpublished the footer.
      expect(
        (await api.put(`/content-blocks/${FOOTER}/text`, { title: 'Edited', body: 'Edited text' }))
          .status,
      ).toBe(200);
      expect((await api.post(`/content-blocks/${FOOTER}/unpublish`)).status).toBe(200);

      // Not for the client's staff (developer recovery).
      expect((await api.post(`/content-blocks/${FOOTER}/reset`)).status).toBe(403);

      const res = await superApi.post(`/content-blocks/${FOOTER}/reset`);
      expect(res.status).toBe(200);
      expect(bodyOf<ApiData<ContentBlockDto>>(res).data).toMatchObject({
        key: FOOTER,
        kind: 'text',
        pending: true,
        isPublished: true,
        translations: { en: { title: null, body: null, ctaLabel: null } },
      });
      expect(await auditCount(ctx, { action: 'content_block.text_reset', entityId: FOOTER })).toBe(
        1,
      );
      const site = await request(ctx.app).get(`/api/v1/site/content/${FOOTER}`);
      expect(bodyOf<{ data: PublicContentBlockDto }>(site).data).toMatchObject({
        status: 'pending',
        title: null,
        parts: [],
      });
    });

    it('does not reset the hero (it holds the video and seeded hero copy)', async () => {
      const superApi = adminClient(ctx, (await signInAdmin(ctx, 'super_admin')).token);
      const res = await superApi.post(`/content-blocks/${HERO}/reset`);
      expect(res.status).toBe(409);
    });
  });
});
