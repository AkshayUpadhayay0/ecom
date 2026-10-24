import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../lib/errors.js';
import { createLocalMediaRouter } from './local-media.routes.js';
import { createLocalStorage } from './local-storage.js';

/*
 * The default media folder is ".media-local" (a folder whose name starts with a dot). Express'
 * sendFile refuses such paths unless the file is served relative to a root, which is what the
 * route now does. Files or folders INSIDE the root that start with a dot stay refused, and
 * traversal out of the root never works.
 */
describe('local media route', () => {
  let base: string;
  let app: express.Express;
  const PNG_LIKE = Buffer.from('not-really-a-png');

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'ui-media-'));
    const root = join(base, '.media-local'); // dot folder, like the default
    await mkdir(join(root, 'public', 'media', 'a1'), { recursive: true });
    await mkdir(join(root, 'public', 'media', '.hidden'), { recursive: true });
    await mkdir(join(root, 'private', 'secret'), { recursive: true });
    await writeFile(join(root, 'public', 'media', 'a1', 'poster.jpg'), PNG_LIKE);
    await writeFile(
      join(root, 'public', 'media', 'a1', 'poster.jpg.meta.json'),
      '{"contentType":"image/jpeg"}',
    );
    await writeFile(join(root, 'public', 'media', '.hidden', 'file.jpg'), PNG_LIKE);
    await writeFile(
      join(root, 'public', 'media', '.hidden', 'file.jpg.meta.json'),
      '{"contentType":"image/jpeg"}',
    );
    await writeFile(join(root, 'private', 'secret', 'evidence.jpg'), 'private-bytes');
    await writeFile(join(base, 'outside.txt'), 'outside the media root');

    const storage = createLocalStorage({
      rootDir: root,
      apiPublicUrl: 'http://localhost:4000',
      secret: 'test-secret-test-secret-test-secret',
      basePath: '/api/v1',
    });
    app = express();
    app.use('/media-local', createLocalMediaRouter(storage));
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status = error instanceof AppError ? error.status : 500;
      res.status(status).json({ error: error instanceof AppError ? error.code : 'INTERNAL_ERROR' });
    });
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('serves a public file from a folder that starts with a dot', async () => {
    const res = await request(app).get('/media-local/public/media/a1/poster.jpg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(res.body as Buffer).equals(PNG_LIKE)).toBe(true);
  });

  it('answers 404 (not 500) for a missing file', async () => {
    const res = await request(app).get('/media-local/public/media/a1/missing.jpg');
    expect(res.status).toBe(404);
  });

  it('still refuses a dot-folder INSIDE the media root', async () => {
    const res = await request(app).get('/media-local/public/media/.hidden/file.jpg');
    expect(res.status).toBe(404);
  });

  it.each([
    '/media-local/public/../private/secret/evidence.jpg',
    '/media-local/public/media/../../private/secret/evidence.jpg',
    '/media-local/public/media/%2e%2e/%2e%2e/private/secret/evidence.jpg',
    '/media-local/public/media/a1/..%2f..%2f..%2foutside.txt',
    '/media-local/public/media/a1/%2e%2e%2f%2e%2e%2f%2e%2e%2f..%2foutside.txt',
    '/media-local/public/..%2foutside.txt',
    '/media-local/public/media/a1/..%5c..%5coutside.txt',
  ])('refuses the traversal attempt %s', async (path) => {
    const res = await request(app).get(path);
    expect([400, 403, 404]).toContain(res.status);
    expect(res.text).not.toContain('outside the media root');
    expect(res.text).not.toContain('private-bytes');
  });

  it('never serves the private bucket through the public route', async () => {
    const res = await request(app).get('/media-local/public/secret/evidence.jpg');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('private-bytes');
  });
});
