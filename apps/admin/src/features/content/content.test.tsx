import { screen, waitFor, within } from '@testing-library/react';
import type { ContentBlockDto, MediaAssetDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, emptyList, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const HERO: ContentBlockDto = {
  id: 'cb-1',
  key: 'home.hero',
  isPublished: true,
  mediaAssetId: null,
  languages: ['en', 'pcm'],
  updatedAt: '2026-10-19T10:00:00.000Z',
  updatedBy: null,
  translations: { en: { title: 'New season', body: null, ctaLabel: 'Shop' } },
};

function video(status: MediaAssetDto['status']): MediaAssetDto {
  return {
    id: 'hero-new',
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 100,
    visibility: 'public',
    status,
    isTemporary: false,
    originalFilename: 'hero.mp4',
    durationMs: null,
    width: null,
    height: null,
    dominantColor: null,
    processingAttempts: 0,
    processingError: null,
    publicUrl: null,
    renditions: [],
    createdAt: '2026-10-19T10:00:00.000Z',
    uploadedAt: null,
    retiredAt: null,
    purgedAt: null,
  };
}

let heroStatus: MediaAssetDto['status'];
let setMediaBodies: unknown[];
let pickerUrls: URL[];

beforeEach(() => {
  apiState.hasSession = true;
  apiState.role = 'admin'; // Content is a client page
  heroStatus = 'processing';
  setMediaBodies = [];
  pickerUrls = [];
  server.use(
    http.get(`${API}/admin/content-blocks`, () => HttpResponse.json(listOf([HERO]))),
    http.get(`${API}/admin/content-blocks/:key`, () => HttpResponse.json({ data: HERO })),
    http.put(`${API}/admin/content-blocks/:key/media`, async ({ request }) => {
      setMediaBodies.push(await request.json());
      return HttpResponse.json({ data: HERO });
    }),
    http.get(`${API}/admin/media/picker`, ({ request }) => {
      pickerUrls.push(new URL(request.url));
      return HttpResponse.json(emptyList());
    }),
    http.post(`${API}/admin/media/uploads`, () =>
      HttpResponse.json(
        {
          data: {
            asset: video('pending'),
            upload: {
              url: 'http://storage.test/put/hero-new',
              method: 'PUT',
              headers: {},
              expiresAt: '2026-10-19T11:00:00.000Z',
            },
          },
        },
        { status: 201 },
      ),
    ),
    http.put('http://storage.test/put/hero-new', () => new HttpResponse(null, { status: 200 })),
    http.post(`${API}/admin/media/hero-new/complete`, () =>
      HttpResponse.json({ data: video('uploaded') }),
    ),
    http.get(`${API}/admin/media/hero-new`, () => HttpResponse.json({ data: video(heroStatus) })),
  );
});

describe('content (client page, limited scope)', () => {
  it('states its scope and offers no image choice, translation editing or hidden-page editing', async () => {
    const { user } = renderApp('/content');
    expect(
      await screen.findByText(/manages the hero video and approved public blocks only/),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: /Choose image/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument(); // copy is read-only
    await user.click(within(dialog).getByRole('button', { name: 'Choose existing video' }));
    await waitFor(() => expect(pickerUrls[0]?.searchParams.get('kind')).toBe('video'));
  });

  it('uploads a new hero video and allows using it only once it is ready', async () => {
    const { user } = renderApp('/content');
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(
      within(dialog).getByLabelText('Upload new video'),
      new File(['mp4'], 'hero.mp4', { type: 'video/mp4' }),
    );
    expect(await within(dialog).findByText('Processing')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Use as this block/ }),
    ).not.toBeInTheDocument();
    heroStatus = 'ready';
    const use = await within(dialog).findByRole(
      'button',
      { name: /Use as this block/ },
      { timeout: 5000 },
    );
    await user.click(use);
    await waitFor(() => expect(setMediaBodies[0]).toEqual({ mediaAssetId: 'hero-new' }));
  });
});
