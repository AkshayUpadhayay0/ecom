import { useQuery } from '@tanstack/react-query';
import type { ContentBlockSummaryDto, MediaKind } from '@urban-ibile/shared';
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
import { configApi } from '@/lib/api/config-api';
import { formatDateTime } from '@/lib/format';
import { useAdminMutation } from '@/lib/use-admin-mutation';

const contentKeys = {
  list: ['config', 'content'] as const,
  block: (key: string) => ['config', 'content', key] as const,
};

function BlockDialog({ blockKey, onClose }: { blockKey: string; onClose: () => void }) {
  const block = useQuery({
    queryKey: contentKeys.block(blockKey),
    queryFn: () => configApi.contentBlock(blockKey),
  });
  const [picker, setPicker] = useState<MediaKind | null>(null);
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
            Text is approved copy applied by developers; here you choose the media and publish.
          </DialogDescription>
        </DialogHeader>
        <QueryView query={block} what="content block">
          {(data) => (
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
                <span className="text-muted-foreground">Media:</span>
                <span className="font-mono text-xs">{data.mediaAssetId ?? 'none'}</span>
                <Button size="sm" variant="outline" onClick={() => setPicker('video')}>
                  Choose video
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPicker('image')}>
                  Choose image
                </Button>
                {data.mediaAssetId ? (
                  <Button size="sm" variant="ghost" onClick={() => setMedia.mutate(null)}>
                    Remove media
                  </Button>
                ) : null}
              </div>
              <MediaPicker
                open={picker !== null}
                onOpenChange={(o) => !o && setPicker(null)}
                kind={picker ?? 'image'}
                multiple={false}
                initial={data.mediaAssetId ? [data.mediaAssetId] : []}
                title={`Choose ${picker ?? 'media'} for ${blockKey}`}
                onPick={(ids) => (ids[0] ? setMedia.mutateAsync(ids[0]) : Promise.resolve())}
              />
            </div>
          )}
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
        English / Pidgin copy is supplied by the client’s writer and applied by developers. There is
        no translation editor by design.
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
                  <TableHead scope="col">Languages</TableHead>
                  <TableHead scope="col">Media</TableHead>
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
                    <TableCell>{b.languages.join(', ') || '—'}</TableCell>
                    <TableCell>{b.mediaAssetId ? 'Set' : '—'}</TableCell>
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
