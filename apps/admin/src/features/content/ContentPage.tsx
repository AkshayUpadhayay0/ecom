import { useQuery } from '@tanstack/react-query';
import {
  CONTENT_KEYS_NOT_SHOWN_ON_SITE,
  CONTENT_NOT_SHOWN_NOTE,
  type ContentBlockSummaryDto,
} from '@urban-ibile/shared';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { ListCard, QueryView } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MediaPicker } from '@/features/media/MediaPicker';
import { TextBlockEditor } from './TextBlockEditor';
import { UploadButton, itemState } from '@/features/products/ProductMediaFields';
import { catalogApi } from '@/lib/api/catalog';
import { configApi } from '@/lib/api/config-api';
import { VIDEO_TYPES, assetRefetchInterval, checkFile, uploadPublicFile } from '@/lib/media-upload';
import { useMediaLimits } from '@/lib/use-media-limits';
import { errorMessage } from '@/lib/notify';
import { formatDateTime } from '@/lib/format';
import { useAdminMutation } from '@/lib/use-admin-mutation';

const contentKeys = {
  list: ['config', 'content'] as const,
  block: (key: string) => ['config', 'content', key] as const,
};

/**
 * Upload a new hero video from Content (the Media Library is internal). Hero video stays
 * ready-only (decision 19 Oct 2026): it can be used once processing has finished.
 */
function HeroVideoUpload({ onUse }: { onUse: (assetId: string) => Promise<unknown> }) {
  const [assetId, setAssetId] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const asset = useQuery({
    queryKey: ['catalog', 'media-asset', assetId],
    queryFn: () => catalogApi.mediaAsset(assetId ?? ''),
    enabled: assetId !== null,
    refetchInterval: assetRefetchInterval,
  });
  const limits = useMediaLimits();
  const [progress, setProgress] = useState<number | null>(null);

  function start(file: File) {
    setFileName(file.name);
    setUploadError(null);
    setAssetId(null);
    setProgress(null);
    const problem = checkFile(file, limits).problem;
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploading(true);
    uploadPublicFile(file, {
      onProgress: (sent, total) => setProgress(total > 0 ? Math.round((sent / total) * 100) : null),
    }).then(
      (created) => {
        setAssetId(created.id);
        setUploading(false);
      },
      (err: unknown) => {
        setUploadError(errorMessage(err));
        setUploading(false);
      },
    );
  }

  const state =
    fileName === ''
      ? null
      : itemState({ key: 'hero', fileName, assetId, uploading, uploadError, progress }, asset.data);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <UploadButton
        label="Upload new video"
        accept={VIDEO_TYPES}
        multiple={false}
        onFiles={(files) => files[0] && start(files[0])}
      />
      {state ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="status">
          <span className="font-medium">{fileName}</span>
          <Badge tone={state.tone}>{state.label}</Badge>
          {state.detail ? <span className="text-muted-foreground">{state.detail}</span> : null}
          {(asset.data?.status === 'ready' || asset.data?.playableAt) && assetId ? (
            <Button size="sm" onClick={() => void onUse(assetId)}>
              Use as this block's video
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          The new video can be used here once processing has finished (usually under a minute for a
          30 second clip). This page updates by itself.
        </p>
      )}
    </div>
  );
}

function BlockDialog({ blockKey, onClose }: { blockKey: string; onClose: () => void }) {
  const block = useQuery({
    queryKey: contentKeys.block(blockKey),
    queryFn: () => configApi.contentBlock(blockKey),
  });
  const [picker, setPicker] = useState(false);
  const setMedia = useAdminMutation((id: string | null) => configApi.setBlockMedia(blockKey, id), {
    success: 'Media updated.',
    invalidate: [contentKeys.list, contentKeys.block(blockKey)],
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{blockKey}</DialogTitle>
          <DialogDescription>
            {block.data?.kind === 'text'
              ? 'Write the English text and save it. Publishing decides whether the shop shows it.'
              : 'Choose or upload the hero video; it is saved as soon as you pick it.'}
          </DialogDescription>
        </DialogHeader>
        <QueryView query={block} what="content block">
          {(data) =>
            data.kind === 'text' ? (
              <TextBlockEditor
                key={data.updatedAt}
                block={data}
                invalidate={[contentKeys.list, contentKeys.block(blockKey)]}
              />
            ) : (
              <div className="space-y-4 text-sm">
                {Object.entries(data.translations).map(([language, t]) => (
                  <div key={language} className="rounded-lg border p-3">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {language}
                    </p>
                    <p className="mt-1 font-medium">{t.title ?? '—'}</p>
                    {t.body ? (
                      <p className="mt-1 whitespace-pre-line text-muted-foreground">{t.body}</p>
                    ) : null}
                    {t.ctaLabel ? <p className="mt-1 text-xs">Button: {t.ctaLabel}</p> : null}
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">Video:</span>
                  <span className="font-mono text-xs">{data.mediaAssetId ?? 'none'}</span>
                  <Button size="sm" variant="outline" onClick={() => setPicker(true)}>
                    Choose existing video
                  </Button>
                  {data.mediaAssetId ? (
                    <Button size="sm" variant="ghost" onClick={() => setMedia.mutate(null)}>
                      Remove media
                    </Button>
                  ) : null}
                </div>
                <HeroVideoUpload onUse={(id) => setMedia.mutateAsync(id)} />
                <MediaPicker
                  open={picker}
                  onOpenChange={(o) => !o && setPicker(false)}
                  kind="video"
                  multiple={false}
                  initial={data.mediaAssetId ? [data.mediaAssetId] : []}
                  title={`Choose a video for ${blockKey}`}
                  onPick={(ids) => (ids[0] ? setMedia.mutateAsync(ids[0]) : Promise.resolve())}
                />
              </div>
            )
          }
        </QueryView>
      </DialogContent>
    </Dialog>
  );
}

export function ContentPage() {
  const blocks = useQuery({
    queryKey: contentKeys.list,
    queryFn: async () => (await configApi.contentBlocks()).data,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [toggling, setToggling] = useState<ContentBlockSummaryDto | null>(null);
  const toggle = useAdminMutation(
    (b: ContentBlockSummaryDto) =>
      b.isPublished ? configApi.unpublishBlock(b.key) : configApi.publishBlock(b.key),
    {
      success: (b) => (b.isPublished ? 'Published.' : 'Unpublished.'),
      invalidate: [contentKeys.list],
    },
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Content"
        description="Site content blocks (hero, banners). Publish them and choose their video or image."
      />
      <InfoBanner>
        Content currently manages the hero video and approved public blocks only (choose or upload
        the video, publish or unpublish). It does not edit the hidden-page write-ups, QR links,
        serial access or translations: English / Pidgin copy is supplied by the client’s writer and
        applied by developers.
      </InfoBanner>
      <ListCard>
        <QueryView
          query={blocks}
          what="content blocks"
          isEmpty={(d) => d.length === 0}
          empty={{
            icon: FileText,
            title: 'No content blocks',
            description: 'Content blocks are created with the site configuration.',
          }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Block</TableHead>
                  <TableHead scope="col">Type</TableHead>
                  <TableHead scope="col">Content</TableHead>
                  <TableHead scope="col">State</TableHead>
                  <TableHead scope="col">Updated</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.key}</TableCell>
                    <TableCell>{b.kind === 'video' ? 'Hero video' : 'Text'}</TableCell>
                    <TableCell>
                      {b.kind === 'video' ? (
                        b.mediaAssetId ? (
                          'Video set'
                        ) : (
                          <span className="text-muted-foreground">No video yet</span>
                        )
                      ) : b.pending ? (
                        <Badge tone="warning">Pending client content</Badge>
                      ) : (
                        'Text provided'
                      )}
                      {CONTENT_KEYS_NOT_SHOWN_ON_SITE.includes(b.key) ? (
                        <div className="mt-1">
                          <Badge title={CONTENT_NOT_SHOWN_NOTE}>Not shown on the website</Badge>
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {b.isPublished ? (
                        <Badge tone="success">Published</Badge>
                      ) : (
                        <Badge>Draft</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(new Date(b.updatedAt))}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(b.key)}>
                        Open
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setToggling(b)}>
                        {b.isPublished ? 'Unpublish' : 'Publish'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      {open ? <BlockDialog blockKey={open} onClose={() => setOpen(null)} /> : null}
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={
          toggling?.isPublished ? `Unpublish ${toggling.key}?` : `Publish ${toggling?.key ?? ''}?`
        }
        description={
          toggling?.isPublished
            ? 'It will no longer appear on the site.'
            : 'It will appear on the site.'
        }
        confirmLabel={toggling?.isPublished ? 'Unpublish' : 'Publish'}
        onConfirm={() => (toggling ? toggle.mutateAsync(toggling) : Promise.resolve())}
      />
    </div>
  );
}
