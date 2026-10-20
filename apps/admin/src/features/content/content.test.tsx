import { screen, waitFor, within } from '@testing-library/react';
import type { ContentBlockDto, MediaAssetDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, emptyList, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const HERO: ContentBlockDto = {
  id: 'cb-1',
  key: 'home.hero',
  kind: 'video',
  pending: false,
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

const TERMS: ContentBlockDto = {
  id: 'cb-2',
  key: 'policy.terms',
  kind: 'text',
  pending: true,
  isPublished: true,
  mediaAssetId: null,
  languages: [],
  updatedAt: '2026-10-20T08:00:00.000Z',
  updatedBy: null,
  translations: {},
};

describe('content editor by type (20 Oct 2026)', () => {
  let textBodies: unknown[];

  beforeEach(() => {
    textBodies = [];
    server.use(
      http.get(`${API}/admin/content-blocks`, () => HttpResponse.json(listOf([HERO, TERMS]))),
      http.get(`${API}/admin/content-blocks/policy.terms`, () =>
        HttpResponse.json({ data: TERMS }),
      ),
      http.put(`${API}/admin/content-blocks/policy.terms/text`, async ({ request }) => {
        const body = (await request.json()) as { title: string; body: string };
        textBodies.push(body);
        return HttpResponse.json({
          data: {
            ...TERMS,
            pending: false,
            updatedAt: '2026-10-20T09:00:00.000Z',
            translations: { en: { title: body.title, body: body.body, ctaLabel: null } },
          },
        });
      }),
    );
  });

  async function openTerms(user: ReturnType<typeof renderApp>['user']) {
    const row = (await screen.findByText('policy.terms')).closest('tr');
    await user.click(within(row ?? document.body).getByRole('button', { name: 'Open' }));
    return screen.findByRole('dialog');
  }

  it('lists the type and the pending state of each block', async () => {
    renderApp('/content');
    const row = (await screen.findByText('policy.terms')).closest('tr');
    expect(within(row ?? document.body).getByText('Text')).toBeInTheDocument();
    expect(within(row ?? document.body).getByText('Pending client content')).toBeInTheDocument();
    const hero = screen.getByText('home.hero').closest('tr');
    expect(within(hero ?? document.body).getByText('Hero video')).toBeInTheDocument();
  });

  it('text blocks get a text editor with Save, and no video controls or language fields', async () => {
    const { user } = renderApp('/content');
    const dialog = await openTerms(user);
    expect(await within(dialog).findByRole('textbox', { name: /Title/ })).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Upload new video')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Choose existing video/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/pcm/i)).not.toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Title/ }), 'Terms of use');
    await user.type(
      within(dialog).getByRole('textbox', { name: /^Text/ }),
      '# Orders{enter}We ship in Lagos.',
    );
    // Live preview of the plain text (heading + paragraph).
    const preview = within(dialog).getByRole('region', { name: 'Preview' });
    expect(within(preview).getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    await user.click(save);
    await waitFor(() =>
      expect(textBodies[0]).toEqual({
        title: 'Terms of use',
        body: ['# Orders', 'We ship in Lagos.'].join('\n'),
      }),
    );
  });

  it('refuses HTML before sending and shows stored text escaped, never as HTML', async () => {
    server.use(
      http.get(`${API}/admin/content-blocks/policy.terms`, () =>
        HttpResponse.json({
          data: {
            ...TERMS,
            pending: false,
            translations: {
              en: {
                title: 'Terms',
                body: 'Stored <img src=x onerror=alert(1)> text',
                ctaLabel: null,
              },
            },
          },
        }),
      ),
    );
    const { user } = renderApp('/content');
    const dialog = await openTerms(user);
    const preview = await within(dialog).findByRole('region', { name: 'Preview' });
    expect(preview.querySelector('img')).toBeNull();
    expect(preview).toHaveTextContent('Stored <img src=x onerror=alert(1)> text');

    const body = within(dialog).getByRole('textbox', { name: /^Text/ });
    await user.clear(body);
    await user.type(body, 'Hello <b>bold</b>');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/plain text/i);
    expect(within(dialog).getByRole('button', { name: 'Update' })).toBeDisabled();
    expect(textBodies).toEqual([]);
  });

  it('the hero keeps its video controls and no text editor', async () => {
    const { user } = renderApp('/content');
    const hero = (await screen.findByText('home.hero')).closest('tr');
    await user.click(within(hero ?? document.body).getByRole('button', { name: 'Open' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByLabelText('Upload new video')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: /^Text/ })).not.toBeInTheDocument();
  });
});
