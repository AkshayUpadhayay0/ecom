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

describe('impactLines', () => {
  it('says exactly who loses the media', () => {
    expect(impactLines(usage())).toEqual([
      'This video is used by: Indigo Kaftan, home.hero.',
      'They will have no video until you choose another.',
    ]);
    expect(impactLines(usage({ products: [], contentBlocks: [] }))).toEqual([
      'This video is not used anywhere.',
    ]);
    expect(
      impactLines(
        usage({
          kind: 'image',
          products: [{ id: 'p-1', name: 'Indigo Kaftan', as: 'image' }],
          contentBlocks: [],
          pendingReplacements: [{ productId: 'p-2', productName: 'Ankara Set', slot: 'images' }],
        }),
      ),
    ).toEqual([
      'This image is used by: Indigo Kaftan.',
      'It will be removed from that page.',
      "The new images waiting to replace Ankara Set's media will be cancelled.",
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
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    const block = await screen.findByRole('dialog');
    await user.click(within(block).getByRole('button', { name: 'Choose existing video' }));
    return screen.findByRole('dialog', { name: /Choose a video/ });
  }

  it('lists the impact, then deletes (detached everywhere, retired)', async () => {
    const { user } = renderApp('/content');
    const picker = await openPicker(user);
    await user.click(await within(picker).findByRole('button', { name: 'Delete indigo.mp4' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete indigo.mp4?' });
    expect(
      await within(confirm).findByText('This video is used by: Indigo Kaftan, home.hero.'),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent(/They will have no video until you choose another/);
    expect(confirm).toHaveTextContent(/file itself is kept until a developer purges it/);
    await user.click(within(confirm).getByRole('button', { name: 'Delete video' }));
    await waitFor(() => expect(deleted).toEqual(['vid-1']));
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
