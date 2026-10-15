import { Writable } from 'node:stream';
import type {
  AdminHiddenPageDto,
  ApiData,
  ApiErrorBody,
  ApiList,
  CustomerAuthDto,
  HiddenPageContentResultDto,
  HiddenPageStateDto,
  SerialDto,
  SerialImportResultDto,
} from '@urban-ibile/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  adminClient,
  auditCount,
  resetAdminApiData,
  signInAdmin,
  type AdminClient,
} from '../../../test/admin-fixtures.js';
import {
  assertSafeTestDatabase,
  bodyOf,
  hasTestDatabase,
  makeTestEnv,
  testDatabaseUrl,
} from '../../../test/helpers.js';
import { createApp } from '../../app.js';
import type { Env } from '../../config/env.js';
import { createDatabase, type Database } from '../../db/database.js';
import { createLogger } from '../../lib/logger.js';
import { GENERIC_SERIAL_FAILURE } from './hidden-pages.service.js';

const PAGES = '/api/v1/hidden-pages';

/** Test serials (plaintext exists ONLY here; the DB and logs must never contain it). */
const SERIALS = {
  generalPage1: 'GN-TEST-PAGE1-00017',
  generalPage2: 'GN-TEST-PAGE2-00042',
  exclusive: 'LE-TEST-EXCLUSIVE-777',
  toDeactivate: 'GN-TEST-PAGE3-00099',
};
const ALL_SERIALS = Object.values(SERIALS);

interface Page {
  id: string;
  slotNumber: number;
  routeToken: string;
  exclusiveOnly: boolean;
}

/** Collects every log line the app writes, to prove serials never reach the logs. */
function captureLogs(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  return { stream, text: () => chunks.join('') };
}

function buildApp(env: Env, db: Database, logs = captureLogs()) {
  const logger = createLogger({ LOG_LEVEL: 'trace', NODE_ENV: 'test' }, logs.stream);
  return { app: createApp({ env, logger, db }), logs };
}

describe.skipIf(!hasTestDatabase)('hidden pages and serial access', () => {
  let env: Env;
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let logs: ReturnType<typeof captureLogs>;
  let api: AdminClient;
  let pages: Page[];
  let originalContent: { qr_page_id: string; language_code: string; title: string; body: string }[];

  const page = (slot: number): Page => {
    const found = pages.find((p) => p.slotNumber === slot);
    if (!found) throw new Error(`No hidden page in slot ${slot}`);
    return found;
  };
  const exclusivePage = (): Page => {
    const found = pages.find((p) => p.exclusiveOnly);
    if (!found) throw new Error('No exclusive-only page');
    return found;
  };

  beforeAll(async () => {
    assertSafeTestDatabase(testDatabaseUrl ?? '');
    env = makeTestEnv({ RATE_LIMIT_MAX: '100000', HIDDEN_UNLOCK_MAX_PER_IP: '1000' });
    db = createDatabase({
      connectionString: env.DATABASE_URL,
      maxConnections: env.DB_POOL_MAX,
      logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }),
    });
    ({ app, logs } = buildApp(env, db));
    pages = await db
      .selectFrom('qr_pages')
      .select([
        'id',
        'slot_number as slotNumber',
        'route_token as routeToken',
        'exclusive_only as exclusiveOnly',
      ])
      .orderBy('slot_number')
      .execute();
    originalContent = await db.selectFrom('qr_page_translations').selectAll().execute();
  });

  async function restoreContent(): Promise<void> {
    for (const row of originalContent) {
      await db
        .updateTable('qr_page_translations')
        .set({ title: row.title, body: row.body })
        .where('qr_page_id', '=', row.qr_page_id)
        .where('language_code', '=', row.language_code)
        .execute();
    }
  }

  async function importSerials(csv: string, query = ''): Promise<request.Response> {
    const res = await request(app)
      .post(`${ADMIN}/serial-imports${query}`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('Content-Type', 'text/csv')
      .send(csv);
    return res;
  }

  let superToken: string;

  beforeEach(async () => {
    const ctx = { app, db, env };
    await resetAdminApiData(ctx);
    await restoreContent();
    superToken = (await signInAdmin(ctx, 'super_admin')).token;
    api = adminClient(ctx, superToken);
    const res = await importSerials(
      [
        'serial,category,pageSlot',
        `${SERIALS.generalPage1},GENERAL,1`,
        `${SERIALS.generalPage2},GENERAL,2`,
        `${SERIALS.exclusive},EXCLUSIVE,`,
        `${SERIALS.toDeactivate},GENERAL,3`,
      ].join('\n'),
      '?sourceName=test-batch',
    );
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await resetAdminApiData({ app, db, env });
    await restoreContent();
    await db.destroy();
  });

  /** `browser` keeps cookies between calls (a supertest agent); omitted = a fresh visitor. */
  function getPage(slot: number, browser?: request.Agent) {
    const path = `${PAGES}/${page(slot).routeToken}`;
    return browser ? browser.get(path) : request(app).get(path);
  }
  function unlock(slot: number, serial: string, browser?: request.Agent) {
    const path = `${PAGES}/${page(slot).routeToken}/unlock`;
    return (browser ? browser.post(path) : request(app).post(path)).send({ serial });
  }
  function stateOf(res: request.Response): HiddenPageStateDto {
    return bodyOf<ApiData<HiddenPageStateDto>>(res).data;
  }

  describe('serial import (admin)', () => {
    it('imports valid rows and reports duplicates and invalid rows by line, never by serial', async () => {
      const csv = [
        'serial,category,pageSlot',
        'GN-NEW-0000000001,GENERAL,4', // line 2 ok
        'GN-NEW-0000000001,GENERAL,4', // line 3 repeated in file
        `${SERIALS.exclusive},EXCLUSIVE,`, // line 4 already imported
        'GN-BAD-0000000002,GENERAL,8', // line 5 exclusive-only page
        'GN-BAD-0000000003,SILVER,1', // line 6 bad category
        'LE-BAD-0000000004,EXCLUSIVE,2', // line 7 exclusive with a page
        '   ,GENERAL,1', // line 8 empty serial
        'GN-BAD-0000000005,GENERAL,', // line 9 missing page
        '"  LE-NEW-QUOTED-01  ",exclusive,', // line 10 ok (quoted, trimmed, case-insensitive category)
      ].join('\r\n');
      const res = await importSerials(csv);
      expect(res.status).toBe(201);
      const result = bodyOf<ApiData<SerialImportResultDto>>(res).data;
      expect(result).toMatchObject({
        totalRows: 9,
        imported: 2,
        byCategory: { GENERAL: 1, EXCLUSIVE: 1 },
      });
      expect(result.duplicates.map((d) => d.line)).toEqual([3, 4]);
      expect(result.invalid.map((i) => i.line)).toEqual([5, 6, 7, 8, 9]);
      expect(JSON.stringify(result)).not.toContain('GN-NEW-0000000001');
      expect(result.duplicates[0]?.hint).toBe('****0001');

      const quoted = await unlock(1, 'LE-NEW-QUOTED-01');
      expect(quoted.status).toBe(200);
      expect(await auditCount(ctx(), { action: 'serial.import' })).toBe(2);
    });

    it('validates without writing on dryRun, and requires the header row', async () => {
      const dry = await importSerials(
        'serial,category,pageSlot\nGN-DRY-000000001,GENERAL,1',
        '?dryRun=true',
      );
      expect(dry.status).toBe(200);
      expect(bodyOf<ApiData<SerialImportResultDto>>(dry).data).toMatchObject({
        dryRun: true,
        batchId: null,
        imported: 1,
      });
      expect((await unlock(1, 'GN-DRY-000000001')).status).toBe(403);

      const noHeader = await importSerials('GN-X-000000001,GENERAL,1');
      expect(noHeader.status).toBe(400);
    });

    it('limits serial administration to super admins', async () => {
      const admin = adminClient(ctx(), (await signInAdmin(ctx(), 'admin')).token);
      expect((await admin.post('/serials/deactivate', { serial: SERIALS.exclusive })).status).toBe(
        403,
      );
      expect((await admin.get('/serial-batches')).status).toBe(403);
    });

    it('never stores the plaintext serial anywhere in the database', async () => {
      await unlock(1, SERIALS.generalPage1);
      await unlock(1, SERIALS.generalPage2); // rejected attempt, logged
      await api.post('/serials/deactivate', { serial: SERIALS.toDeactivate });

      const tables = [
        'serial_numbers',
        'serial_import_batches',
        'page_access_grants',
        'qr_access_events',
        'admin_audit_logs',
      ];
      for (const table of tables) {
        const dump = await sql<{ row: string }>`
          SELECT row_to_json(t)::text AS row FROM ${sql.table(table)} AS t`.execute(db);
        const text = dump.rows.map((r) => r.row).join('\n');
        for (const serial of ALL_SERIALS) expect(text, table).not.toContain(serial);
      }
      const stored = await db
        .selectFrom('serial_numbers')
        .select(['serial_hash', 'serial_hint'])
        .execute();
      expect(stored.every((row) => /^[0-9a-f]{64}$/.test(row.serial_hash))).toBe(true);
      expect(stored.map((row) => row.serial_hint)).toContain('****0017');
    });
  });

  describe('public unlock', () => {
    it('answers 404 for unknown route tokens and {locked:true} without a grant', async () => {
      expect((await request(app).get(`${PAGES}/not-a-real-token`)).status).toBe(404);
      const locked = await getPage(1);
      expect(locked.status).toBe(200);
      expect(stateOf(locked)).toEqual({ locked: true, pageNumber: 1, title: 'Hidden page 1' });
      expect(locked.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(locked.headers['cache-control']).toBe('no-store');
    });

    it('GENERAL unlocks only its own page; the cookie is HttpOnly and the URL alone does not unlock', async () => {
      const browser = request.agent(app);
      const res = await unlock(1, SERIALS.generalPage1, browser);
      expect(res.status).toBe(200);
      // State answers never carry the content (that is GET /:routeToken/content).
      expect(stateOf(res)).toEqual({ locked: false, pageNumber: 1, title: 'Hidden page 1' });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^ui_hp=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\/api\/v1\/hidden-pages/);

      expect(stateOf(await getPage(1, browser)).locked).toBe(false);
      expect(stateOf(await getPage(2, browser)).locked).toBe(true);
      // Same URL, different browser (no cookie): still locked.
      expect(stateOf(await getPage(1)).locked).toBe(true);

      const otherPage = await unlock(2, SERIALS.generalPage1, browser);
      expect(otherPage.status).toBe(403);
    });

    it('GENERAL never opens the exclusive-only page; EXCLUSIVE opens every page', async () => {
      const general = await unlock(exclusivePage().slotNumber, SERIALS.generalPage1);
      expect(general.status).toBe(403);

      const browser = request.agent(app);
      const res = await unlock(exclusivePage().slotNumber, SERIALS.exclusive, browser);
      expect(res.status).toBe(200);
      for (const p of pages)
        expect(stateOf(await getPage(p.slotNumber, browser)).locked).toBe(false);
    });

    it('accumulates grants in one browser and is not one-time use', async () => {
      const browser = request.agent(app);
      const first = await unlock(1, SERIALS.generalPage1, browser);
      expect(first.headers['set-cookie']).toBeDefined();
      const second = await unlock(2, SERIALS.generalPage2, browser);
      expect(second.headers['set-cookie']).toBeUndefined(); // same browser token reused
      expect(stateOf(await getPage(1, browser)).locked).toBe(false);
      expect(stateOf(await getPage(2, browser)).locked).toBe(false);
      expect(stateOf(await getPage(3, browser)).locked).toBe(true);

      // The same serial works again, in another browser too (no consumption, no expiry).
      expect((await unlock(1, SERIALS.generalPage1, browser)).status).toBe(200);
      expect((await unlock(1, SERIALS.generalPage1, request.agent(app))).status).toBe(200);

      const grants = await db
        .selectFrom('page_access_grants')
        .select(['scope', 'expires_at', 'browser_token_hash'])
        .execute();
      expect(grants).toHaveLength(3); // repeat unlock in the same browser adds no duplicate
      expect(grants.every((g) => g.expires_at === null)).toBe(true);
      const serialsUsed = await db.selectFrom('serial_numbers').select('is_active').execute();
      expect(serialsUsed.every((s) => s.is_active)).toBe(true);
    });

    it('returns the SAME generic failure for unknown, wrong-page, inactive and empty serials', async () => {
      const browser = request.agent(app);
      expect((await unlock(3, SERIALS.toDeactivate, browser)).status).toBe(200);
      const deactivated = await api.post('/serials/deactivate', { serial: SERIALS.toDeactivate });
      expect(bodyOf<ApiData<SerialDto>>(deactivated).data).toMatchObject({
        isActive: false,
        hint: '****0099',
        allowedPageSlot: 3,
      });
      expect(JSON.stringify(deactivated.body)).not.toContain(SERIALS.toDeactivate);
      // Assumption: deactivation also withdraws access already granted by that serial.
      expect(stateOf(await getPage(3, browser)).locked).toBe(true);

      const attempts = [
        await unlock(3, 'GN-NOT-A-REAL-SERIAL'),
        await unlock(3, SERIALS.generalPage1),
        await unlock(3, SERIALS.toDeactivate),
        await unlock(3, '   '),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(403);
        const { error } = bodyOf<ApiErrorBody>(res);
        expect(error.code).toBe('SERIAL_NOT_VALID');
        expect(error.message).toBe(GENERIC_SERIAL_FAILURE);
        expect(error.details).toBeUndefined();
      }
      const rejected = await db
        .selectFrom('qr_access_events')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('outcome', '=', 'SERIAL_REJECTED')
        .executeTakeFirstOrThrow();
      expect(Number(rejected.n)).toBe(attempts.length);
      expect(await auditCount(ctx(), { action: 'serial.deactivate' })).toBe(1);
    });

    it('serves content only with a grant for that page; otherwise the same locked answer', async () => {
      const contentOf = async (slot: number, browser?: request.Agent) => {
        const path = `${PAGES}/${page(slot).routeToken}/content`;
        const res = await (browser ? browser.get(path) : request(app).get(path));
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        return bodyOf<ApiData<HiddenPageContentResultDto>>(res).data;
      };
      expect(await contentOf(1)).toEqual({ locked: true, pageNumber: 1, title: 'Hidden page 1' });

      const browser = request.agent(app);
      await unlock(1, SERIALS.generalPage1, browser);
      const unlocked = await contentOf(1, browser);
      expect(unlocked.locked).toBe(false);
      expect('page' in unlocked && unlocked.page.body.length > 0).toBe(true);
      // Same browser, another page: locked answer, no content.
      expect(await contentOf(2, browser)).toEqual({
        locked: true,
        pageNumber: 2,
        title: 'Hidden page 2',
      });
      // The grant persists: a later request with the same cookie still gets the content.
      expect((await contentOf(1, browser)).locked).toBe(false);
      // Without the cookie (copied URL), no content.
      expect((await contentOf(1)).locked).toBe(true);
      expect((await request(app).get(`${PAGES}/no-such-token/content`)).status).toBe(404);
    });

    it('pauses before answering a failed unlock (configurable delay)', async () => {
      const slow = buildApp(
        makeTestEnv({ RATE_LIMIT_MAX: '100000', HIDDEN_UNLOCK_FAILURE_DELAY_MS: '250' }),
        db,
      );
      const started = Date.now();
      const res = await request(slow.app)
        .post(`${PAGES}/${page(1).routeToken}/unlock`)
        .send({ serial: 'NOPE-NOPE' });
      expect(res.status).toBe(403);
      expect(Date.now() - started).toBeGreaterThanOrEqual(240);
    });

    it('remembers the signed-in customer so another browser of the same account is unlocked', async () => {
      const registered = await request(app).post('/api/v1/auth/register').send({
        email: 'hidden-page-fan@example.com',
        password: 'Ankara-Velvet-2026!',
        fullName: 'Hidden Page Fan',
        acceptTerms: true,
        client: 'ios',
      });
      expect(registered.status).toBe(201);
      const token = bodyOf<ApiData<CustomerAuthDto>>(registered).data.tokens.accessToken;

      const res = await request(app)
        .post(`${PAGES}/${page(1).routeToken}/unlock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ serial: SERIALS.generalPage1 });
      expect(res.status).toBe(200);
      const elsewhere = await request(app)
        .get(`${PAGES}/${page(1).routeToken}`)
        .set('Authorization', `Bearer ${token}`);
      expect(stateOf(elsewhere).locked).toBe(false);
    });
  });

  describe('admin hidden pages', () => {
    it('lists every page with its stable route token and public URL', async () => {
      const res = await api.get('/hidden-pages');
      const list = bodyOf<ApiList<AdminHiddenPageDto>>(res);
      expect(list.meta.total).toBe(pages.length);
      expect(list.data[0]).toMatchObject({
        slotNumber: 1,
        routeToken: page(1).routeToken,
        publicUrl: `${env.PUBLIC_WEB_URL}/h/${page(1).routeToken}`,
      });
      expect(list.data.find((p) => p.exclusiveOnly)?.slotNumber).toBe(exclusivePage().slotNumber);
    });

    it('edits title/content without ever changing the route token (audited)', async () => {
      const target = page(2);
      const res = await api.put(`/hidden-pages/${target.id}/content`, {
        title: 'The Lagos Story',
        body: 'Final write-up for page 2.',
      });
      expect(res.status).toBe(200);
      expect(bodyOf<ApiData<AdminHiddenPageDto>>(res).data).toMatchObject({
        title: 'The Lagos Story',
        routeToken: target.routeToken,
      });
      const row = await db
        .selectFrom('qr_pages')
        .select(['route_token', 'slug'])
        .where('id', '=', target.id)
        .executeTakeFirstOrThrow();
      expect(row.route_token).toBe(target.routeToken);

      const browser = request.agent(app);
      expect((await unlock(2, SERIALS.generalPage2, browser)).status).toBe(200);
      const content = await browser.get(`${PAGES}/${target.routeToken}/content`);
      expect(bodyOf<ApiData<HiddenPageContentResultDto>>(content).data).toEqual({
        locked: false,
        pageNumber: 2,
        title: 'Hidden page 2',
        page: { title: 'The Lagos Story', body: 'Final write-up for page 2.' },
      });
      expect(
        await auditCount(ctx(), { action: 'hidden_page.content_update', entityId: target.id }),
      ).toBe(1);
      // There is no endpoint to change slugs or tokens.
      expect((await api.patch(`/hidden-pages/${target.id}`, { routeToken: 'x' })).status).toBe(404);
    });
  });

  it('never writes a plaintext serial to the logs', async () => {
    await unlock(1, SERIALS.generalPage1);
    await unlock(2, SERIALS.generalPage1);
    await unlock(1, 'GN-WRONG-SERIAL-55555');
    await api.post('/serials/deactivate', { serial: SERIALS.toDeactivate });
    const text = logs.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('serial rejected');
    for (const serial of [...ALL_SERIALS, 'GN-WRONG-SERIAL-55555'])
      expect(text).not.toContain(serial);
  });

  function ctx() {
    return { app, db, env };
  }

  describe('rate limiting', () => {
    it('blocks repeated FAILED attempts per IP (successes do not count) and logs them', async () => {
      const limited = buildApp(
        makeTestEnv({ RATE_LIMIT_MAX: '100000', HIDDEN_UNLOCK_MAX_PER_IP: '3' }),
        db,
      );
      const attempt = (serial: string) =>
        request(limited.app)
          .post(`${PAGES}/${page(1).routeToken}/unlock`)
          .send({ serial });

      for (let i = 0; i < 5; i += 1) expect((await attempt(SERIALS.generalPage1)).status).toBe(200);
      for (let i = 0; i < 3; i += 1) expect((await attempt(`WRONG-${i}`)).status).toBe(403);
      const blocked = await attempt(SERIALS.generalPage1);
      expect(blocked.status).toBe(429);
      expect(bodyOf<ApiErrorBody>(blocked).error.code).toBe('RATE_LIMITED');
      const events = await db
        .selectFrom('qr_access_events')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('outcome', '=', 'RATE_LIMITED')
        .executeTakeFirstOrThrow();
      expect(Number(events.n)).toBe(1);
    });

    it('blocks repeated failures against one page across many IPs (per route token)', async () => {
      const limited = buildApp(
        makeTestEnv({
          RATE_LIMIT_MAX: '100000',
          TRUST_PROXY: '1',
          HIDDEN_UNLOCK_MAX_PER_IP: '1000',
          HIDDEN_UNLOCK_MAX_PER_PAGE: '4',
        }),
        db,
      );
      const attempt = (slot: number, ip: string) =>
        request(limited.app)
          .post(`${PAGES}/${page(slot).routeToken}/unlock`)
          .set('X-Forwarded-For', ip)
          .send({ serial: 'GUESS' });

      for (let i = 0; i < 4; i += 1)
        expect((await attempt(1, `203.0.113.${i + 1}`)).status).toBe(403);
      expect((await attempt(1, '203.0.113.99')).status).toBe(429);
      // Another page has its own budget.
      expect((await attempt(2, '203.0.113.99')).status).toBe(403);
    });
  });
});
