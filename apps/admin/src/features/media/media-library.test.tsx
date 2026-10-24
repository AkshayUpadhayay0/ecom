import { screen, waitFor, within } from '@testing-library/react';
import type { MediaLibraryItemDto, MediaUsageDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

function item(id: string, overrides: Partial<MediaLibraryItemDto> = {}): MediaLibraryItemDto {
  return {
    id,
    kind: 'image',
    mimeType: 'image/jpeg',
    sizeBytes: 100,
    visibility: 'public',
    status: 'ready',
    isTemporary: false,
    originalFilename: `${id}.jpg`,
    durationMs: null,
    width: null,
    height: null,
    dominantColor: null,
    processingAttempts: 0,
    processingError: null,
    publicUrl: null,
    renditions: [],
    createdAt: '2026-10-22T10:00:00.000Z',
    uploadedAt: null,
    retiredAt: null,
    purgedAt: null,
    usedBy: { products: [], contentBlocks: [], pendingReplacements: 0 },
    ...overrides,
  };
}

const ATTACHED = item('front', {
  usedBy: {
    products: [{ id: 'p-a', name: 'Product A', as: 'image' }],
    contentBlocks: [],
    pendingReplacements: 0,
  },
});
const FAILED = item('broken', { status: 'failed', processingError: 'decode failed' });

const USAGE: MediaUsageDto = {
  assetId: 'front',
  kind: 'image',
  products: [{ id: 'p-a', name: 'Product A', as: 'image' }],
  contentBlocks: [],
  pendingReplacements: [],
  hiddenPages: [],
  deletable: true,
  blockedReason: null,
};

let listUrls: URL[];
let calls: string[];

beforeEach(() => {
  apiState.hasSession = true;
  apiState.role = 'admin'; // the client's staff use the Media Library (22 Oct 2026)
  listUrls = [];
  calls = [];
  server.use(
    http.get(`${API}/admin/media`, ({ request }) => {
      listUrls.push(new URL(request.url));
      return HttpResponse.json(listOf([ATTACHED, FAILED]));
    }),
    http.get(`${API}/admin/media/front/usage`, () => HttpResponse.json({ data: USAGE })),
    http.delete(`${API}/admin/media/front`, () => {
      calls.push('delete front');
      return HttpResponse.json({
        data: { assetId: 'front', retiredAt: '2026-10-22T11:00:00.000Z', detached: USAGE },
      });
    }),
    http.post(`${API}/admin/media/broken/retry`, () => {
      calls.push('retry broken');
      return HttpResponse.json({ data: { ...FAILED, status: 'uploaded' } });
    }),
  );
});

describe('Media Library for a regular admin', () => {
  it('shows Used by, status per file, and the Unused filter', async () => {
    const { user } = renderApp('/media');
    const front = (await screen.findByText('front.jpg')).closest('li');
    expect(front).toHaveTextContent('Used by: Product A (product image)');
    const broken = screen.getByText('broken.jpg').closest('li');
    expect(broken).toHaveTextContent('Used by: Unused');
    expect(within(broken ?? document.body).getByText('Failed')).toBeInTheDocument();
    // No visibility filter: private files are never shown in the library.
    expect(screen.queryByRole('combobox', { name: 'Visibility' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Usage' }), 'true');
    await waitFor(() => expect(listUrls.at(-1)?.searchParams.get('unused')).toBe('true'));
  });

  it('retries a failed file', async () => {
    const { user } = renderApp('/media');
    const broken = (await screen.findByText('broken.jpg')).closest('li');
    await user.click(within(broken ?? document.body).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(calls).toContain('retry broken'));
  });

  it('Delete on a card lists what will be detached, with Cancel and Confirm', async () => {
    const { user } = renderApp('/media');
    await user.click(await screen.findByRole('button', { name: 'Delete front.jpg' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete front.jpg?' });
    expect(
      await within(confirm).findByText('This image is used by: Product A (product image).'),
    ).toBeInTheDocument();
    expect(confirm).toHaveTextContent('Deleting it will remove it from that product.');
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(calls).toContain('delete front'));
  });

  it('physical purge stays a super admin action', async () => {
    renderApp('/media');
    expect(await screen.findByRole('button', { name: /Clean up retired/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('Media list regression: "Couldn\'t load media" after a 304', () => {
  it('shows the files, not an error, when the first answer is "304 Not Modified"', async () => {
    let calls = 0;
    server.use(
      http.get(`${API}/admin/media`, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 304 })
          : HttpResponse.json(listOf([ATTACHED, FAILED]));
      }),
    );
    renderApp('/media');
    expect(await screen.findByText('front.jpg')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it('a network failure on the list says the server could not be reached (with a retry), not a vague error', async () => {
    server.use(http.get(`${API}/admin/media`, () => HttpResponse.error()));
    renderApp('/media');
    // The query retries a few times before giving up, so allow for the back-off.
    expect(
      await screen.findByText(/couldn.t load media/i, {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cannot reach the server/)).toBeInTheDocument();
  }, 30_000);
});
