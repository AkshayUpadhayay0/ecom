import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MediaAssetDto, MediaLibraryItemDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const MB = 1024 * 1024;
const STORAGE = 'http://storage.test/put/clip-1';

function asset(status: MediaAssetDto['status'], extra: Partial<MediaAssetDto> = {}): MediaAssetDto {
  return {
    id: 'clip-1',
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 5 * MB,
    visibility: 'public',
    status,
    isTemporary: false,
    originalFilename: 'clip.mp4',
    durationMs: null,
    width: null,
    height: null,
    dominantColor: null,
    processingAttempts: 0,
    processingError: null,
    playableAt: null,
    publicUrl: null,
    renditions: [],
    createdAt: new Date().toISOString(), // just uploaded: polled every 2 s
    uploadedAt: new Date().toISOString(),
    retiredAt: null,
    purgedAt: null,
    ...extra,
  };
}

function asLibraryItem(a: MediaAssetDto): MediaLibraryItemDto {
  return { ...a, usedBy: { products: [], contentBlocks: [], pendingReplacements: 0 } };
}

function videoFile(sizeBytes: number, name = 'clip.mp4', type = 'video/mp4'): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

let polls: number;
/** From this poll on the file is playable (the shop shows it) although not every size is done. */
let playableAfter: number;
let statuses: MediaAssetDto['status'][];
let requests: string[];

beforeEach(() => {
  apiState.hasSession = true;
  apiState.role = 'admin';
  polls = 0;
  playableAfter = Number.POSITIVE_INFINITY;
  requests = [];
  statuses = ['uploaded', 'processing', 'ready'];
  server.use(
    http.get(`${API}/admin/settings`, () =>
      HttpResponse.json(
        listOf([
          {
            key: 'media.max_video_bytes',
            value: String(500 * MB),
            defaultValue: null,
            description: null,
            updatedAt: null,
            updatedBy: null,
          },
          {
            key: 'media.max_image_bytes',
            value: String(20 * MB),
            defaultValue: null,
            description: null,
            updatedAt: null,
            updatedBy: null,
          },
        ]),
      ),
    ),
    http.post(`${API}/admin/media/uploads`, () => {
      requests.push('create');
      return HttpResponse.json(
        {
          data: {
            asset: asset('pending'),
            upload: {
              url: STORAGE,
              method: 'PUT',
              headers: { 'Content-Type': 'video/mp4' },
              expiresAt: new Date().toISOString(),
            },
          },
        },
        { status: 201 },
      );
    }),
    http.put(STORAGE, () => {
      requests.push('put');
      return new HttpResponse(null, { status: 200 });
    }),
    http.post(`${API}/admin/media/clip-1/complete`, () => {
      requests.push('complete');
      return HttpResponse.json({ data: asset('uploaded') });
    }),
    http.get(`${API}/admin/media/clip-1`, () => {
      const status = statuses[Math.min(polls, statuses.length - 1)] ?? 'ready';
      const playable = polls >= playableAfter;
      polls += 1;
      return HttpResponse.json({
        data: asset(status, {
          ...(playable ? { playableAt: new Date().toISOString() } : {}),
          ...(status === 'failed'
            ? {
                processingError: playable
                  ? 'Some video sizes could not be made; the video still plays with the sizes that exist. disk full'
                  : 'ffmpeg exited with code 1: corrupt moov atom',
              }
            : {}),
        }),
      });
    }),
    http.get(`${API}/admin/media`, () => HttpResponse.json(listOf([]))),
  );
});

async function openUpload() {
  const view = renderApp('/media');
  await view.user.click(await screen.findByRole('button', { name: 'Upload' }));
  return { ...view, dialog: await screen.findByRole('dialog', { name: 'Upload media' }) };
}

describe('Upload dialog: limits and friendly errors', () => {
  it('shows the real limits and the recommended settings', async () => {
    const { dialog } = await openUpload();
    await waitFor(() => expect(dialog).toHaveTextContent('up to 500.0 MB'));
    expect(dialog).toHaveTextContent('Images: JPEG, PNG, WebP (up to 20.0 MB)');
    expect(dialog).toHaveTextContent(
      'Recommended video: MP4 (H.264), 1080p or smaller, about 8 to 10 Mbps, 60 seconds or less.',
    );
  });

  it('refuses a too-large video at once, with the limit and what to do, and sends nothing', async () => {
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(612 * MB));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('This video is 612 MB; the largest we accept is 500 MB.');
    expect(alert).toHaveTextContent('1080p');
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(requests).toEqual([]);
  });

  it('refuses a file type we do not accept', async () => {
    const { dialog } = await openUpload();
    const input = within(dialog).getByLabelText(/File/);
    // bypass the accept filter, like a drag and drop would
    fireEvent.change(input, {
      target: { files: [videoFile(MB, 'plan.pdf', 'application/pdf')] },
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'plan.pdf is not a type we accept',
    );
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeDisabled();
  });

  it('warns about a very large video but still allows it', async () => {
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(200 * MB));
    expect(await within(dialog).findByText(/bigger than needed/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeEnabled();
  });
});

describe('Upload dialog: progress, then live processing without a refresh', () => {
  it('uploads, then follows Queued, Processing and Ready by itself', async () => {
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(5 * MB));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    // the upload itself reports a real progress bar, then the worker's states follow
    await waitFor(() => expect(requests).toEqual(['create', 'put', 'complete']));
    await within(dialog).findByRole('progressbar');
    expect(
      await within(dialog).findByText(/Waiting for the background worker/),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByText(/Processing: making the web versions/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByText(/Ready: every size is complete/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Ready')).toBeInTheDocument();
    // it stops asking once ready
    const settled = polls;
    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(polls).toBe(settled);
    expect(within(dialog).getByRole('button', { name: 'Upload another' })).toBeInTheDocument();
  }, 20000);

  it('says Playable as soon as the shop can show it, before every size is done', async () => {
    statuses = ['processing', 'processing', 'ready'];
    playableAfter = 1;
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(5 * MB));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(
      await within(dialog).findByText(/Playable: the shop already shows it/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Playable')).toBeInTheDocument();
    expect(
      await within(dialog).findByText(/Ready: every size is complete/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
  }, 20000);

  it('a size that failed after it became playable is a warning, not a failure', async () => {
    statuses = ['processing', 'failed'];
    playableAfter = 1;
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(5 * MB));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    expect(
      await within(dialog).findByText(/Playable with a warning/, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('still plays with the sizes that exist');
    expect(within(dialog).queryByText('Failed')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Upload a different file/)).not.toBeInTheDocument();
  }, 20000);

  it('shows a failed file with the real reason and what to do', async () => {
    statuses = ['processing', 'failed'];
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(5 * MB));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    const alert = await within(dialog).findByText(/corrupt moov atom/, {}, { timeout: 8000 });
    expect(alert).toBeInTheDocument();
    expect(within(dialog).getByText('Failed')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      'Upload a different file, or open it in the library and choose Retry.',
    );
  }, 20000);

  it('can be closed while processing and the library keeps updating', async () => {
    statuses = ['processing', 'processing', 'ready'];
    const { user, dialog } = await openUpload();
    await user.upload(within(dialog).getByLabelText(/File/), videoFile(5 * MB));
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await within(dialog).findByText(/Processing: making the web versions/, {}, { timeout: 8000 });
    expect(dialog).toHaveTextContent('You can close this window');
    // the footer button (the dialog's own corner X is also called Close)
    await user.click(
      within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement,
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Upload media' })).not.toBeInTheDocument(),
    );
  }, 20000);
});

describe('Media library updates by itself', () => {
  it('a file that is processing turns Ready on the page without a refresh, then polling stops', async () => {
    let lists = 0;
    server.use(
      http.get(`${API}/admin/media`, () => {
        lists += 1;
        return HttpResponse.json(
          listOf([asLibraryItem(asset(lists < 3 ? 'processing' : 'ready'))]),
        );
      }),
    );
    renderApp('/media');
    const card = (await screen.findByText('clip.mp4')).closest('li');
    expect(card).toHaveTextContent('Processing');
    await waitFor(
      () => expect(screen.getByText('clip.mp4').closest('li')).toHaveTextContent('Ready'),
      { timeout: 9000 },
    );
    const settled = lists;
    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(lists).toBe(settled); // nothing is working any more: no more requests
  }, 20000);

  it('does not poll a library with nothing in progress', async () => {
    let lists = 0;
    server.use(
      http.get(`${API}/admin/media`, () => {
        lists += 1;
        return HttpResponse.json(listOf([asLibraryItem(asset('ready'))]));
      }),
    );
    renderApp('/media');
    await screen.findByText('clip.mp4');
    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(lists).toBe(1);
  }, 10000);
});
