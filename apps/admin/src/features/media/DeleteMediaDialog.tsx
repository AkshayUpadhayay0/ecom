import { useQuery } from '@tanstack/react-query';
import type { MediaKind, MediaUsageDto } from '@urban-ibile/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoBanner } from '@/components/PageHeader';
import { LoadingBlock } from '@/components/QueryStates';
import { catalogApi } from '@/lib/api/catalog';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { catalogKeys } from '@/features/products/products.queries';

export interface MediaToDelete {
  id: string;
  kind: MediaKind;
  name: string;
}

/** Plain-language impact of deleting a file, built from its usage. */
export function impactLines(usage: MediaUsageDto): string[] {
  const noun = usage.kind === 'video' ? 'video' : 'image';
  const users = [
    ...usage.products
      .filter((p) => (usage.kind === 'video' ? p.as === 'video' : p.as === 'image'))
      .map((p) => p.name),
    ...usage.contentBlocks.map((b) => b.key),
  ];
  const lines: string[] = [];
  if (users.length === 0 && usage.pendingReplacements.length === 0) {
    lines.push(`This ${noun} is not used anywhere.`);
  } else if (users.length > 0) {
    lines.push(`This ${noun} is used by: ${users.join(', ')}.`);
    lines.push(
      usage.kind === 'video'
        ? `${users.length === 1 ? 'It' : 'They'} will have no video until you choose another.`
        : `It will be removed from ${users.length === 1 ? 'that page' : 'those pages'}.`,
    );
  }
  for (const pending of usage.pendingReplacements) {
    lines.push(
      `The new ${pending.slot === 'video' ? 'video' : 'images'} waiting to replace ${pending.productName}'s media will be cancelled.`,
    );
  }
  return lines;
}

/**
 * Delete an uploaded PUBLIC image / video (20 Oct 2026): detached from every product, the hero and
 * pending replacements, then retired (gone from pickers and the shop). The stored files stay until
 * a developer purges them. Mounted only while open.
 */
export function DeleteMediaDialog({
  media,
  onClose,
  onDeleted,
}: {
  media: MediaToDelete | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  return media ? <DeleteMedia media={media} onClose={onClose} onDeleted={onDeleted} /> : null;
}

function DeleteMedia({
  media,
  onClose,
  onDeleted,
}: {
  media: MediaToDelete;
  onClose: () => void;
  onDeleted: ((id: string) => void) | undefined;
}) {
  const usage = useQuery({
    queryKey: ['catalog', 'media-usage', media.id],
    queryFn: () => catalogApi.mediaUsage(media.id),
    staleTime: 0,
  });
  const remove = useAdminMutation(() => catalogApi.deleteMedia(media.id), {
    success: `${media.kind === 'video' ? 'Video' : 'Image'} deleted.`,
    invalidate: [catalogKeys.all, ['config', 'content']],
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${media.name}?`}
      description="It disappears from the media picker and the shop. The file itself is kept until a developer purges it, so this can still be recovered."
      confirmLabel={`Delete ${media.kind}`}
      destructive
      confirmDisabled={usage.data?.deletable !== true}
      onConfirm={async () => {
        await remove.mutateAsync(undefined);
        onDeleted?.(media.id);
      }}
    >
      {usage.isPending ? (
        <LoadingBlock rows={1} label="where it is used" />
      ) : usage.data ? (
        usage.data.deletable ? (
          <ul className="space-y-1 text-sm" aria-label="What will change">
            {impactLines(usage.data).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <InfoBanner tone="warning">{usage.data.blockedReason}</InfoBanner>
        )
      ) : (
        <p role="alert" className="text-sm text-destructive">
          Could not check where this file is used. Try again.
        </p>
      )}
    </ConfirmDialog>
  );
}
