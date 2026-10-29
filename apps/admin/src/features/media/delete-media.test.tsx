import { screen, waitFor, within } from '@testing-library/react';
import type { ContentBlockDto, MediaAssetDto, MediaUsageDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import { impactLines } from './DeleteMediaDialog';

const VIDEO: MediaAssetDto = {
  id: 'vid-1',
  kind: 'video',
  mimeType: 'video/mp4',
  sizeBytes: 100,
  visibility: 'public',
  status: 'ready',
  isTemporary: false,
  originalFilename: 'indigo.mp4',
  durationMs: null,
  width: null,
  height: null,
  dominantColor: null,
  processingAttempts: 0,
  processingError: null,
  playableAt: null,
  publicUrl: null,
  renditions: [],
  createdAt: '2026-10-19T10:00:00.000Z',
  uploadedAt: null,
  retiredAt: null,
  purgedAt: null,
};

const HERO: ContentBlockDto = {
  id: 'cb-1',
  key: 'home.hero',
  kind: 'video',
  pending: false,
  isPublished: true,
  mediaAssetId: null,
  languages: ['en'],
  updatedAt: '2026-10-19T10:00:00.000Z',
  updatedBy: null,
  translations: {},
};

function usage(overrides: Partial<MediaUsageDto> = {}): MediaUsageDto {
  return {
    assetId: 'vid-1',
    kind: 'video',
    products: [{ id: 'p-1', name: 'Indigo Kaftan', as: 'video' }],
    contentBlocks: [{ key: 'home.hero' }],
    pendingReplacements: [],
    hiddenPages: [],
    deletable: true,
    blockedReason: null,
    ...overrides,
  };
}

describe('impactLines (exact confirmation text)', () => {
  it('unused media', () => {
    expect(impactLines(usage({ products: [], contentBlocks: [] }))).toEqual([
      'This video is not used anywhere. Deleting it does not change the shop.',
    ]);
  });

  it('used by one product', () => {
    expect(impactLines(usage({ contentBlocks: [] }))).toEqual([
      'This video is used by: Indigo Kaftan (product video).',
      'Deleting it will remove it from that product.',
      'It will have no video until you choose another.',
    ]);
  });

  it('used by the homepage hero only', () => {
    expect(impactLines(usage({ products: [] }))).toEqual([
      'This video is used by: the homepage hero.',
      'Deleting it will remove it from the homepage hero.',
      'It will have no video until you choose another.',
    ]);
  });

  it('used by a product and the hero (the example wording)', () => {
    expect(impactLines(usage())).toEqual([
      'This video is used by: Indigo Kaftan (product video) and the homepage hero.',
      'Deleting it will remove it from both.',
      'They will have no video until you choose another.',
    ]);
  });

  it('an image used by several places, with a pending replacement', () => {
    expect(
      impactLines(
        usage({
          kind: 'image',
          products: [
            { id: 'p-1', name: 'Indigo Kaftan', as: 'image' },
            { id: 'p-2', name: 'Ankara Set', as: 'image' },
            { id: 'p-3', name: 'Fila Cap', as: 'image' },
          ],
          contentBlocks: [],
          pendingReplacements: [{ productId: 'p-4', productName: 'Agbada', slot: 'images' }],
        }),
      ),
    ).toEqual([
      'This image is used by: Indigo Kaftan (product image), Ankara Set (product image) and Fila Cap (product image).',
      'Deleting it will remove it from all 3 places.',
      'They will no longer show this image.',
      "The new images waiting to replace Agbada's media will be cancelled.",
    ]);
  });
});

describe('delete media from the picker (20 Oct 2026)', () => {
  let deleted: string[];
  let currentUsage: MediaUsageDto;

  beforeEach(() => {
    apiState.hasSession = true;
    apiState.role = 'admin';
    deleted = [];
    currentUsage = usage();
    server.use(
      http.get(`${API}/admin/content-blocks`, () => HttpResponse.json(listOf([HERO]))),
      http.get(`${API}/admin/content-blocks/:key`, () => HttpResponse.json({ data: HERO })),
      http.get(`${API}/admin/media/picker`, () => HttpResponse.json(listOf([VIDEO]))),
      http.get(`${API}/admin/media/vid-1/usage`, () => HttpResponse.json({ data: currentUsage })),
      http.delete(`${API}/admin/media/vid-1`, () => {
        deleted.push('vid-1');
        return HttpResponse.json({
          data: { assetId: 'vid-1', retiredAt: '2026-10-20T10:00:00.000Z', detached: currentUsage },
        });
      }),
    );
  });

  async function openPicker(user: ReturnType<typeof renderApp>['user']) {
    // Generous waits: the full Content page renders slowly under parallel test load.
    const slow = { timeout: 5000 };
    await user.click(await screen.findByRole('button', { name: 'Open' }, slow));
    const block = await screen.findByRole('dialog', {}, slow);
    await user.click(within(block).getByRole('button', { name: 'Choose existing video' }));
    return screen.findByRole('dialog', { name: /Choose a video/ }, slow);
  }

  it('lists the impact, then deletes (detached everywhere, retired)', async () => {
    const { user } = renderApp('/content');
    const picker = await openPicker(user);
    // Generous waits: this full-app flow is slow under parallel test load.
    const slow = { timeout: 5000 };
    await user.click(
      await within(picker).findByRole('button', { name: 'Delete indigo.mp4' }, slow),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Delete indigo.mp4?' }, slow);
    expect(
      await within(confirm).findByText(
        'This video is used by: Indigo Kaftan (product video) and the homepage hero.',
        {},
        slow,
      ),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(/Deleting it will remove it from both/);
    expect(confirm).toHaveTextContent(/They will have no video until you choose another/);
    expect(confirm).toHaveTextContent(/file itself is kept until a developer purges it/);
    await user.click(within(confirm).getByRole('button', { name: 'Delete video' }));
    await waitFor(() => expect(deleted).toEqual(['vid-1']), slow);
  });

  it('explains when it cannot be deleted yet and keeps the button disabled', async () => {
    currentUsage = usage({
      deletable: false,
      blockedReason:
        'This file is still being processed. Wait until it is ready (or failed), then delete it.',
    });
    const { user } = renderApp('/content');
    const picker = await openPicker(user);
    await user.click(await within(picker).findByRole('button', { name: 'Delete indigo.mp4' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete indigo.mp4?' });
    expect(await within(confirm).findByText(/still being processed/)).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Delete video' })).toBeDisabled();
  });
});

describe('the same impact text in every Delete place', () => {
  beforeEach(() => {
    apiState.hasSession = true;
    server.use(
      http.get(`${API}/admin/media/picker`, () =>
        HttpResponse.json(
          listOf([{ ...VIDEO, id: 'vid-1', kind: 'image', originalFilename: 'front.jpg' }]),
        ),
      ),
      http.get(`${API}/admin/media`, () =>
        HttpResponse.json(
          listOf([
            { ...VIDEO, usedBy: { products: [], contentBlocks: [], pendingReplacements: 0 } },
          ]),
        ),
      ),
      http.get(`${API}/admin/media/vid-1`, () => HttpResponse.json({ data: VIDEO })),
      http.get(`${API}/admin/media/vid-1/url`, () =>
        HttpResponse.json({ data: { url: 'http://cdn.test/indigo.mp4', expiresAt: null } }),
      ),
      http.get(`${API}/admin/media/vid-1/usage`, () =>
        HttpResponse.json({
          data: usage({
            kind: 'image',
            products: [{ id: 'p-1', name: 'Indigo Kaftan', as: 'image' }],
            contentBlocks: [],
          }),
        }),
      ),
      http.get(`${API}/admin/clothing-types`, () =>
        HttpResponse.json(
          listOf([
            {
              id: 'ct-1',
              slug: 'kaftan',
              name: 'Kaftan',
              searchKeywords: '',
              sortOrder: 0,
              isActive: true,
            },
          ]),
        ),
      ),
      http.get(`${API}/admin/measurement-profiles`, () => HttpResponse.json(listOf([]))),
      http.get(`${API}/admin/products`, () => HttpResponse.json(listOf([]))),
    );
  });

  it('product form: Choose existing -> Delete shows what will be detached', async () => {
    apiState.role = 'admin';
    const { user } = renderApp('/products');
    await user.click(await screen.findByRole('button', { name: 'New product' }));
    const form = await screen.findByRole('dialog', { name: 'New product' });
    await user.click(within(form).getByRole('button', { name: 'Choose existing images' }));
    const picker = await screen.findByRole('dialog', { name: 'Choose existing images' });
    await user.click(await within(picker).findByRole('button', { name: 'Delete front.jpg' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete front.jpg?' });
    expect(
      await within(confirm).findByText('This image is used by: Indigo Kaftan (product image).'),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent('It will no longer show this image.');
  });

  it('Media Library (super admin): Delete shows the same impact text', async () => {
    apiState.role = 'super_admin';
    const { user } = renderApp('/media');
    await user.click(await screen.findByRole('button', { name: /^indigo\.mp4/ }));
    const asset = await screen.findByRole('dialog', { name: 'indigo.mp4' });
    await user.click(within(asset).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete indigo.mp4?' });
    expect(
      await within(confirm).findByText('This image is used by: Indigo Kaftan (product image).'),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent('Deleting it will remove it from that product.');
  });
});
