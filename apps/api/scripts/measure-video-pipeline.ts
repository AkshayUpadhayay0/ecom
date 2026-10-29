/**
 * Measures the video pipeline end to end on a throw-away stack and prints a timing table:
 *
 *   pnpm --filter @urban-ibile/api measure:video -- --label before [--web] [--out report.json]
 *
 * It starts the API (:4010), the worker and (with --web) the website's production build (:3100)
 * against the *_test database with LOCAL storage, creates a temporary admin, uploads a typical
 * 30 s, 1080p, ~50 MB MP4 through the real admin endpoints, and times every step:
 *   upload to storage -> "complete" -> worker claims -> each stage -> status ready -> public API
 *   shows it -> (--web) the website's home page shows it.
 * Everything it creates is removed again. NOTE: the browser's own upload time to R2 depends on the
 * editor's connection and is not measured here: it is the file size divided by the upload speed.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import {
  assertSafeTestDatabase,
  redactUrl,
  resolveTestDatabaseUrl,
} from '../test/safe-database.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, '..');
const REPO = resolve(API_DIR, '../..');
const WEB_DIR = join(REPO, 'apps/web');
const API_PORT = 4010;
const WEB_PORT = 3100;
const API = `http://localhost:${API_PORT}/api/v1`;
const WEB = `http://localhost:${WEB_PORT}`;
/** TEST ONLY shared secret between the measured API/worker and website. */
const REVALIDATE_SECRET = 'measure-revalidate-secret-not-for-production-01';
const ADMIN_EMAIL = `measure-video-${Date.now()}@example.test`; // unique: an admin row can outlive a run (audit log)
const ADMIN_PASSWORD = 'Quartz-Lantern-Harbour-7391!';
const POLL_MS = 100;
const WEB_POLL_MS = 1000;
const WEB_TIMEOUT_MS = 4 * 60_000;
const MB = 1024 * 1024;

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
const option = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback;
};
const label = option('label', 'run');
const withWeb = flag('web');
const out = option('out', '');

const now = (): number => performance.now();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

loadDotenv({ path: join(REPO, '.env') });
const resolved = resolveTestDatabaseUrl(process.env);
if (!resolved) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL.');
assertSafeTestDatabase(resolved.url);
console.log(`Database: ${redactUrl(resolved.url)}`);

const mediaDir = join(tmpdir(), 'ui-measure-media');
mkdirSync(mediaDir, { recursive: true });
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: resolved.url,
  TEST_DATABASE_URL: resolved.url,
  MEDIA_STORAGE_DRIVER: 'local',
  MEDIA_LOCAL_DIR: mediaDir,
  API_PUBLIC_URL: `http://localhost:${API_PORT}`,
  PUBLIC_WEB_URL: WEB,
  CORS_ORIGINS: WEB,
  PORT: String(API_PORT),
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  PUBLIC_RATE_LIMIT_MAX: '100000',
  LOG_LEVEL: 'info',
  // TEST ONLY: with --web the worker tells the website to refresh when media is ready.
  ...(withWeb
    ? {
        WEB_REVALIDATE_URL: `http://localhost:${WEB_PORT}/api/revalidate`,
        WEB_REVALIDATE_SECRET: REVALIDATE_SECRET,
      }
    : {}),
};

const children: ChildProcess[] = [];
function start(
  name: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  lines?: (l: string) => void,
) {
  const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (chunk: Buffer): void => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) lines?.(line);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (code && code !== 0 && code !== 1) console.log(`${name} exited with ${code}`);
  });
  children.push(child);
  return child;
}
function stopAll(): void {
  for (const child of children) {
    if (child.pid)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
}

async function waitFor(url: string, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`${url} did not come up in ${ms / 1000} s`);
}

/** A typical phone / camera upload: 30 s, 1920x1080, audio, about 50 MB. */
function makeTestVideo(): string {
  const file = join(tmpdir(), 'ui-measure-30s-1080p.mp4');
  if (existsSync(file)) return file;
  const stock = join(REPO, 'docs/design-proposal/v3/.cache/stock/9510022-uhd_2732_1440_25fps.mp4');
  const source = existsSync(stock)
    ? ['-stream_loop', '1', '-i', stock]
    : ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30'];
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-v',
      'error',
      ...source,
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '30',
      '-vf',
      'scale=1920:1080,fps=30',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-b:v',
      '13M',
      '-maxrate',
      '15M',
      '-bufsize',
      '30M',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-shortest',
      file,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error('ffmpeg could not make the test video');
  return file;
}

interface Json {
  data?: Record<string, unknown>;
}
async function api(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string>),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Json & { error?: { message?: string } };
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${body.error?.message ?? ''}`);
  return body.data ?? {};
}

async function main(): Promise<void> {
  const video = makeTestVideo();
  const sizeBytes = statSync(video).size;
  console.log(`Test video: ${(sizeBytes / MB).toFixed(1)} MB`);

  // seed (website needs its sample data), then the stack
  const seed = spawnSync('pnpm', ['--filter', '@urban-ibile/web', 'e2e:seed'], {
    cwd: REPO,
    env: childEnv,
    shell: true,
    stdio: 'inherit',
  });
  if (seed.status !== 0) throw new Error('e2e seed failed');

  const workerLines: string[] = [];
  start('api', 'pnpm exec tsx --conditions=source src/server.ts', API_DIR, childEnv);
  await waitFor(`${API}/site/config`, 90_000);
  start('worker', 'pnpm exec tsx --conditions=source src/worker.ts', API_DIR, childEnv, (l) =>
    workerLines.push(l),
  );
  const workerUp = Date.now();
  while (
    !workerLines.some((l) => l.includes('email outbox enabled')) &&
    Date.now() - workerUp < 60_000
  )
    await sleep(200);
  if (withWeb) {
    if (!existsSync(join(WEB_DIR, '.next-e2e/BUILD_ID')))
      throw new Error(
        'Build the website first: pnpm --filter @urban-ibile/web exec playwright test --list (builds .next-e2e), or run the e2e suite once.',
      );
    start('web', `pnpm exec next start -p ${WEB_PORT}`, WEB_DIR, {
      ...childEnv,
      NEXT_DIST_DIR: '.next-e2e',
      API_BASE_URL: `http://localhost:${API_PORT}`,
      NEXT_PUBLIC_API_BASE_URL: `http://localhost:${API_PORT}`,
      NEXT_PUBLIC_SITE_URL: WEB,
      NEXT_ALLOW_LOCAL_MEDIA: 'true',
      REVALIDATE_SECRET,
      NODE_ENV: 'production',
    });
    await waitFor(WEB, 60_000);
    await fetch(WEB); // warm the page cache like a visitor would have
  }

  // temporary admin
  const { loadEnv } = await import('../src/config/env.js');
  const { createDatabase } = await import('../src/db/database.js');
  const { buildAdminAuthService } = await import('../src/modules/admin-users/admin-auth.module.js');
  const { pino } = await import('pino');
  Object.assign(process.env, childEnv);
  const env = loadEnv();
  const db = createDatabase({
    connectionString: env.DATABASE_URL,
    maxConnections: 1,
    logger: pino({ level: 'silent' }),
  });
  await buildAdminAuthService(env, db, pino({ level: 'silent' })).createAdmin({
    email: ADMIN_EMAIL,
    displayName: 'Measure',
    password: ADMIN_PASSWORD,
    role: 'admin',
  });
  const login = await api('/admin/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const token = (login.tokens as { accessToken: string }).accessToken;
  const heroBefore = (await api('/admin/content-blocks/home.hero', token)) as {
    mediaAssetId?: string | null;
  };

  const t: Record<string, number> = {};
  const T0 = now();
  const created = (await api('/admin/media/uploads', token, {
    method: 'POST',
    body: JSON.stringify({
      fileName: 'measure.mp4',
      mimeType: 'video/mp4',
      sizeBytes,
      visibility: 'public',
      isTemporary: false,
    }),
  })) as {
    asset: { id: string };
    upload: { url: string; method: string; headers: Record<string, string> };
  };
  const id = created.asset.id;
  t.createUpload = now() - T0;

  const bytes = readFileSync(video);
  const tPut = now();
  const put = await fetch(created.upload.url, {
    method: created.upload.method,
    headers: created.upload.headers,
    body: bytes,
  });
  if (!put.ok) throw new Error(`storage PUT ${put.status}`);
  t.upload = now() - tPut;

  const tComplete = now();
  await api(`/admin/media/${id}/complete`, token, { method: 'POST' });
  t.complete = now() - tComplete;
  const tQueued = now();

  let claimed: number | null = null;
  let ready: number | null = null;
  let status = '';
  const end = Date.now() + 15 * 60_000;
  while (Date.now() < end) {
    const asset = (await api(`/admin/media/${id}`, token)) as {
      status: string;
      processingError?: string;
    };
    if (asset.status !== status) status = asset.status;
    if (status === 'processing' && claimed === null) claimed = now() - tQueued;
    if (status === 'ready') {
      ready = now() - tQueued;
      break;
    }
    if (status === 'failed') throw new Error(`processing failed: ${asset.processingError ?? ''}`);
    await sleep(POLL_MS);
  }
  if (ready === null) throw new Error('timed out waiting for ready');
  t.claim = claimed ?? 0;
  t.ready = ready;

  // worker's own stage timings
  const stageLine = workerLines.find((l) => l.includes('"msg":"media ready"') && l.includes(id));
  const stages = stageLine
    ? ((JSON.parse(stageLine) as { stagesMs?: Record<string, number> }).stagesMs ?? {})
    : {};

  // put it on the home hero and watch the API, then the website
  const tAssign = now();
  await api('/admin/content-blocks/home.hero/media', token, {
    method: 'PUT',
    body: JSON.stringify({ mediaAssetId: id }),
  });
  let apiSeen: number | null = null;
  while (now() - tAssign < 60_000) {
    const cfg = (await api('/site/config', null)) as {
      hero?: { video?: { posterUrl?: string } | null };
    };
    if (cfg.hero?.video?.posterUrl?.includes(id)) {
      apiSeen = now() - tAssign;
      break;
    }
    await sleep(250);
  }
  t.publicApi = apiSeen ?? -1;
  let webSeen: number | null = null;
  if (withWeb) {
    const tw = now();
    while (now() - tw < WEB_TIMEOUT_MS) {
      const html = await (
        await fetch(`${WEB}/`, { headers: { 'Cache-Control': 'no-cache' } })
      ).text();
      if (html.includes(id)) {
        webSeen = now() - tw;
        break;
      }
      await sleep(WEB_POLL_MS);
    }
    t.website = webSeen ?? -1;
  }

  const rows: [string, string][] = [
    ['Request the upload URL', seconds(t.createUpload)],
    [
      `Upload ${(sizeBytes / MB).toFixed(0)} MB to storage (localhost, so best case)`,
      seconds(t.upload),
    ],
    ['"Complete" call (size, type and magic-byte check)', seconds(t.complete)],
    ['Wait until the worker claims the job', seconds(t.claim)],
    ...Object.entries(stages).map(([k, v]): [string, string] => [`  worker: ${k}`, seconds(v)]),
    ['Queued until status = ready', seconds(t.ready)],
    [
      'Ready until the public API shows it (after assigning it to the hero)',
      t.publicApi >= 0 ? seconds(t.publicApi) : 'not seen in 60 s',
    ],
    ...(withWeb
      ? ([
          [
            'Ready until the website home page shows it',
            (t.website ?? -1) >= 0 ? seconds(t.website as number) : 'not seen in 4 min',
          ],
        ] as [string, string][])
      : []),
  ];
  console.log(`\n=== ${label}: 30 s 1080p video, ${(sizeBytes / MB).toFixed(1)} MB ===`);
  for (const [name, value] of rows) console.log(`${name.padEnd(72)} ${value}`);
  if (out)
    writeFileSync(
      out,
      JSON.stringify({ label, sizeBytes, timingsMs: t, stagesMs: stages }, null, 2),
    );
  // clean up (never hides the table above)
  const quiet = async (work: () => Promise<unknown>): Promise<void> => {
    try {
      await work();
    } catch {
      /* best effort */
    }
  };
  await quiet(() =>
    api('/admin/content-blocks/home.hero/media', token, {
      method: 'PUT',
      body: JSON.stringify({ mediaAssetId: heroBefore.mediaAssetId ?? null }),
    }),
  );
  await quiet(() =>
    api('/admin/content-blocks/home.hero/media', token, {
      method: 'PUT',
      body: JSON.stringify({ mediaAssetId: null }),
    }),
  );
  await quiet(() => api(`/admin/media/${id}`, token, { method: 'DELETE' }));
  await quiet(() => db.deleteFrom('admin_users').where('email', '=', ADMIN_EMAIL).execute());
  await db.destroy();
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    stopAll();
    spawnSync('pnpm', ['--filter', '@urban-ibile/web', 'e2e:cleanup'], {
      cwd: REPO,
      env: childEnv,
      shell: true,
      stdio: 'ignore',
    });
  });
