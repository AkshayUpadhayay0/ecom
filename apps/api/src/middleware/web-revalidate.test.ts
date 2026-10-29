import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { WebRevalidator } from '../lib/web-revalidate.js';
import { revalidateWebsiteAfterAdminWrites } from './web-revalidate.js';

function appWith(revalidate: WebRevalidator['revalidate']) {
  const app = express();
  const revalidator: WebRevalidator = { enabled: true, revalidate, flush: () => Promise.resolve() };
  const admin = express.Router();
  admin.all('/products/1', (_req, res) => res.status(200).json({}));
  admin.all('/orders/1', (_req, res) => res.status(200).json({}));
  admin.all('/media/1', (_req, res) => res.status(422).json({}));
  app.use('/admin', revalidateWebsiteAfterAdminWrites(revalidator), admin);
  return app;
}

/** 'finish' fires just after the client has the response. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('revalidateWebsiteAfterAdminWrites', () => {
  it('asks for a refresh after a successful write in a public area', async () => {
    const revalidate = vi.fn();
    await request(appWith(revalidate)).patch('/admin/products/1').expect(200);
    await settle();
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it('ignores reads, other areas and failed writes', async () => {
    const revalidate = vi.fn();
    const app = appWith(revalidate);
    await request(app).get('/admin/products/1').expect(200);
    await request(app).patch('/admin/orders/1').expect(200);
    await request(app).delete('/admin/media/1').expect(422);
    await settle();
    expect(revalidate).not.toHaveBeenCalled();
  });
});
