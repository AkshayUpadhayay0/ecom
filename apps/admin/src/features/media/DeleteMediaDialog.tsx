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

const HERO_BLOCK_KEY = 'home.hero';

/** "a", "a and b", "a, b and c". */
function joinPlaces(places: readonly string[]): string {
  if (places.length <= 1) return places.join('');
  return `${places.slice(0, -1).join(', ')} and ${places.at(-1) ?? ''}`;
}

/** Where the file is shown, in words the client uses. */
function placesOf(usage: MediaUsageDto): string[] {
  return [
    ...usage.products.map((p) => `${p.name} (product ${p.as === 'video' ? 'video' : 'image'})`),
    ...usage.contentBlocks.map((b) =>
      b.key === HERO_BLOCK_KEY ? 'the homepage hero' : `the ${b.key} content block`,
    ),
  ];
}

/**
 * Plain-language impact of deleting a file, built from GET /admin/media/:id/usage. Lists exactly
 * what is detached, e.g. "This video is used by: Indigo Kaftan (product video) and the homepage
 * hero. Deleting it will remove it from both. They will have no video until you choose another."
 */
export function impactLines(usage: MediaUsageDto): string[] {
  const noun = usage.kind === 'video' ? 'video' : 'image';
  const places = placesOf(usage);
  const lines: string[] = [];
  if (places.length === 0 && usage.pendingReplacements.length === 0) {
    lines.push(`This ${noun} is not used anywhere. Deleting it does not change the shop.`);
    return lines;
  }
  if (places.length > 0) {
    lines.push(`This ${noun} is used by: ${joinPlaces(places)}.`);
    const single = usage.products.length === 1 ? 'that product' : (places[0] ?? 'there');
    lines.push(
      places.length === 1
        ? `Deleting it will remove it from ${single}.`
        : places.length === 2
          ? 'Deleting it will remove it from both.'
          : `Deleting it will remove it from all ${places.length} places.`,
    );
    const subject = places.length === 1 ? 'It' : 'They';
    lines.push(
      usage.kind === 'video'
        ? `${subject} will have no video until you choose another.`
        : `${subject} will no longer show this image.`,
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
