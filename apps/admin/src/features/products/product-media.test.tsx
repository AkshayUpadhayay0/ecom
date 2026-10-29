import { screen, waitFor, within } from '@testing-library/react';
import type { ClothingTypeDto, MediaAssetDto, ProductDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, emptyList, errorResponse, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const TYPE: ClothingTypeDto = {
  id: 'ct-1',
  slug: 'kaftan',
  name: 'Kaftan',
  searchKeywords: '',
  sortOrder: 0,
  isActive: true,
};

function asset(id: string, overrides: Partial<MediaAssetDto> = {}): MediaAssetDto {
  return {
    id,
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 100,
    visibility: 'public',
    status: 'ready',
    isTemporary: false,
    originalFilename: `${id}.mp4`,
    durationMs: null,
    width: null,
    height: null,
    dominantColor: null,
    processingAttempts: 0,
    processingError: null,
    publicUrl: null,
    renditions: [],
    createdAt: new Date().toISOString(), // just uploaded: the page polls a new file quickly
    uploadedAt: null,
    retiredAt: null,
    purgedAt: null,
    ...overrides,
  };
}

const PRODUCT: ProductDto = {
  id: 'p-1',
  slug: 'fit-kaftan',
  name: 'Fit Kaftan',
  clothingType: { id: 'ct-1', slug: 'kaftan', name: 'Kaftan' },
  measurementProfile: null,
  priceMinor: 1_500_000,
  currency: 'NGN',
  status: 'active',
  displayOrder: 0,
  searchKeywords: '',
  videoAssetId: 'live-video',
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  description: 'A tailored kaftan.',
  imageAssetIds: [],
  pendingMedia: { videoAssetId: null, imageAssetIds: null },
};

/** Server-side asset states (what GET /admin/media/:id answers). */
let assets: Map<string, MediaAssetDto>;
let calls: { method: string; path: string; body?: unknown }[];
let uploadCount: number;

function uploadHandlers() {
  return [
    http.post(`${API}/admin/media/uploads`, async ({ request }) => {
      const body = (await request.json()) as { fileName: string; mimeType: string };
      calls.push({ method: 'POST', path: 'uploads', body });
      uploadCount += 1;
      const id = `new-${uploadCount}`;
      const kind = body.mimeType.startsWith('video/') ? 'video' : 'image';
      assets.set(id, asset(id, { kind, status: 'pending', originalFilename: body.fileName }));
      return HttpResponse.json(
        {
          data: {
            asset: assets.get(id),
            upload: {
              url: `http://storage.test/put/${id}`,
              method: 'PUT',
              headers: {},
              expiresAt: '2026-10-19T11:00:00.000Z',
            },
          },
        },
        { status: 201 },
      );
    }),
    http.put('http://storage.test/put/:id', () => new HttpResponse(null, { status: 200 })),
    http.post(`${API}/admin/media/:id/complete`, ({ params }) => {
      const id = String(params.id);
      const current = assets.get(id) ?? asset(id);
      // The API queues it; for these tests the worker has started processing.
      assets.set(id, { ...current, status: 'processing' });
      calls.push({ method: 'POST', path: `complete/${id}` });
      return HttpResponse.json({ data: assets.get(id) });
    }),
    http.get(`${API}/admin/media/picker`, ({ request }) => {
      calls.push({ method: 'GET', path: `picker${new URL(request.url).search}` });
      return HttpResponse.json(
        listOf([asset('lib-image', { kind: 'image', originalFilename: 'library.jpg' })]),
      );
    }),
    http.get(`${API}/admin/media/:id`, ({ params }) => {
      const found = assets.get(String(params.id));
      return found
        ? HttpResponse.json({ data: found })
        : errorResponse(404, 'NOT_FOUND', 'Media asset not found.');
    }),
    http.post(`${API}/admin/media/:id/retry`, ({ params }) => {
      const id = String(params.id);
      calls.push({ method: 'POST', path: `retry/${id}` });
      const current = assets.get(id) ?? asset(id);
      assets.set(id, { ...current, status: 'uploaded', processingError: null });
      return HttpResponse.json({ data: assets.get(id) });
    }),
  ];
}

beforeEach(() => {
  apiState.hasSession = true;
  apiState.role = 'admin'; // the client's staff use the product form
  assets = new Map([['live-video', asset('live-video', { originalFilename: 'current.mp4' })]]);
  calls = [];
  uploadCount = 0;
  server.use(
    ...uploadHandlers(),
    http.get(`${API}/admin/products`, () => HttpResponse.json(listOf([PRODUCT]))),
    http.get(`${API}/admin/products/:id`, () => HttpResponse.json({ data: PRODUCT })),
    http.get(`${API}/admin/products/:id/variants`, () => HttpResponse.json(emptyList())),
    http.get(`${API}/admin/clothing-types`, () => HttpResponse.json(listOf([TYPE]))),
    http.get(`${API}/admin/measurement-profiles`, () => HttpResponse.json(emptyList())),
    http.get(`${API}/admin/sizes`, () => HttpResponse.json(emptyList())),
    http.get(`${API}/catalog/products/:slug`, () =>
      errorResponse(404, 'NOT_FOUND', 'Product not found.'),
    ),
    http.post(`${API}/admin/products`, async ({ request }) => {
      calls.push({ method: 'POST', path: 'products', body: await request.json() });
      return HttpResponse.json({ data: { ...PRODUCT, id: 'p-new' } }, { status: 201 });
    }),
    http.patch(`${API}/admin/products/:id`, async ({ request }) => {
      calls.push({ method: 'PATCH', path: 'product', body: await request.json() });
      return HttpResponse.json({ data: PRODUCT });
    }),
    http.put(`${API}/admin/products/:id/video`, async ({ request }) => {
      const body = (await request.json()) as { mediaAssetId: string };
      calls.push({ method: 'PUT', path: 'video', body });
      return HttpResponse.json({
        data: {
          ...PRODUCT,
          pendingMedia: { videoAssetId: body.mediaAssetId, imageAssetIds: null },
        },
      });
    }),
    http.put(`${API}/admin/products/:id/images`, async ({ request }) => {
      calls.push({ method: 'PUT', path: 'images', body: await request.json() });
      return HttpResponse.json({ data: PRODUCT });
    }),
  );
});

async function fillNewProduct(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'New product' }));
  const dialog = await screen.findByRole('dialog', { name: 'New product' });
  await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Adire Kaftan');
  await user.type(within(dialog).getByRole('textbox', { name: /Price/ }), '25000');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /Clothing type/ }), 'ct-1');
  await user.type(within(dialog).getByRole('textbox', { name: /Description/ }), 'Hand-dyed.');
  return dialog;
}

describe('product form media (decision 19 Oct 2026)', () => {
  it('uploads a video and images inside the NEW product form and saves their ids with the product', async () => {
    const { user } = renderApp('/products');
    const dialog = await fillNewProduct(user);

    await user.upload(
      within(dialog).getByLabelText('Upload new video'),
      new File(['mp4'], 'look.mp4', { type: 'video/mp4' }),
    );
    await user.upload(
      within(dialog).getByLabelText('Upload new image'),
      new File(['jpg'], 'front.jpg', { type: 'image/jpeg' }),
    );
    const video = within(dialog).getByRole('region', { name: 'Product video' });
    expect(await within(video).findByText('Processing')).toBeInTheDocument();
    const images = within(dialog).getByRole('region', { name: 'Product images' });
    expect(await within(images).findByText('Processing')).toBeInTheDocument();
    // Uploads are public product media.
    expect(calls.find((c) => c.path === 'uploads')?.body).toMatchObject({ visibility: 'public' });

    // Saving is allowed while files are still processing.
    await user.click(within(dialog).getByRole('button', { name: 'Create product' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === 'products')?.body).toMatchObject({
        name: 'Adire Kaftan',
        videoAssetId: 'new-1',
        imageAssetIds: ['new-2'],
      }),
    );
  });

  it('shows a failed file with its error, blocks saving, and retries it', async () => {
    const { user } = renderApp('/products');
    const dialog = await fillNewProduct(user);
    await user.upload(
      within(dialog).getByLabelText('Upload new video'),
      new File(['mp4'], 'look.mp4', { type: 'video/mp4' }),
    );
    const video = within(dialog).getByRole('region', { name: 'Product video' });
    await within(video).findByText('Processing');
    assets.set('new-1', asset('new-1', { status: 'failed', processingError: 'ffmpeg exited 1' }));
    // Polling picks up the failure.
    expect(await within(video).findByText('Failed', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(video).getByText('ffmpeg exited 1')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create product' })).toBeDisabled();
    expect(within(dialog).getByText(/Retry or remove the files that failed/)).toBeInTheDocument();

    await user.click(within(video).getByRole('button', { name: 'Retry' }));
    expect(await within(video).findByText('Pending')).toBeInTheDocument();
    expect(calls.some((c) => c.path === 'retry/new-1')).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Create product' })).toBeEnabled();
  }, 10_000);

  it('"Choose existing" lists public ready media from the picker endpoint', async () => {
    const { user } = renderApp('/products');
    const dialog = await fillNewProduct(user);
    await user.click(within(dialog).getByRole('button', { name: 'Choose existing images' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose existing images' });
    await user.click(await within(picker).findByRole('button', { name: 'library.jpg' }));
    await user.click(within(picker).getByRole('button', { name: 'Use selection' }));
    expect(calls.find((c) => c.path.startsWith('picker'))?.path).toContain('kind=image');
    await user.click(within(dialog).getByRole('button', { name: 'Create product' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === 'products')?.body).toMatchObject({
        imageAssetIds: ['lib-image'],
      }),
    );
  });

  it('editing: a new video still processing "will replace the current video when ready"', async () => {
    const { user } = renderApp('/products/p-1');
    await user.click(await screen.findByRole('button', { name: 'Edit images and video' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit product' });
    await user.upload(
      within(dialog).getByLabelText('Upload new video'),
      new File(['mp4'], 'new-look.mp4', { type: 'video/mp4' }),
    );
    expect(
      await within(dialog).findByText('Will replace the current video when ready'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === 'video')?.body).toEqual({ mediaAssetId: 'new-1' }),
    );
    // Images were not touched, so they are not re-sent.
    expect(calls.some((c) => c.path === 'images')).toBe(false);
    expect(
      await screen.findByText(/new media will replace the current media when it is ready/),
    ).toBeInTheDocument();
  });
});
