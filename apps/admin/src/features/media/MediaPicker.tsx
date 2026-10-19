import { useQuery } from '@tanstack/react-query';
import type { MediaAssetDto, MediaKind } from '@urban-ibile/shared';
import { Check, ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { Pagination } from '@/components/Pagination';
import { QueryView } from '@/components/QueryStates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { catalogApi } from '@/lib/api/catalog';
import { errorMessage } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { catalogKeys } from '@/features/products/products.queries';
import { MediaThumb } from './MediaThumb';

const PICKER_PAGE_SIZE = 24;

/**
 * "Choose existing": pick processed, public media for reuse (GET /admin/media/picker, every
 * admin): one video, or an ordered list of images (the order of clicks is the display order).
 */
interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: MediaKind;
  multiple: boolean;
  initial: string[];
  title: string;
  onPick: (ids: string[]) => Promise<unknown>;
}

/** Mounted only while open, so the selection starts from `initial` each time. */
export function MediaPicker(props: MediaPickerProps) {
  return props.open ? <MediaPickerDialog {...props} /> : null;
}

function MediaPickerDialog({
  open,
  onOpenChange,
  kind,
  multiple,
  initial,
  title,
  onPick,
}: MediaPickerProps) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = { kind, page, pageSize: PICKER_PAGE_SIZE };
  const media = useQuery({
    queryKey: [...catalogKeys.media(params), 'picker'],
    queryFn: () => catalogApi.mediaPicker(params),
  });

  function toggle(asset: MediaAssetDto) {
    setSelected((current) => {
      if (!multiple) return current[0] === asset.id ? [] : [asset.id];
      return current.includes(asset.id)
        ? current.filter((id) => id !== asset.id)
        : [...current, asset.id];
    });
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onPick(selected);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Reuse a processed, public {kind === 'video' ? 'video' : 'image'} that was uploaded
            before.
            {multiple ? ' Click images in the order they should appear.' : ''}
          </DialogDescription>
        </DialogHeader>
        <QueryView
          query={media}
          what="media"
          isEmpty={(data) => data.data.length === 0}
          empty={{
            icon: ImageIcon,
            title: 'Nothing to choose yet',
            description: 'Nothing has been uploaded and processed yet. Upload a new file instead.',
          }}
        >
          {(data) => (
            <div className="space-y-3">
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {data.data.map((asset) => {
                  const position = selected.indexOf(asset.id);
                  return (
                    <li key={asset.id}>
                      <button
                        type="button"
                        onClick={() => toggle(asset)}
                        aria-pressed={position >= 0}
                        aria-label={`${asset.originalFilename ?? asset.id}${position >= 0 ? `, selected ${multiple ? `#${position + 1}` : ''}` : ''}`}
                        className={cn(
                          'relative block w-full rounded-lg ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
                          position >= 0 && 'ring-2 ring-accent',
                        )}
                      >
                        <MediaThumb asset={asset} />
                        {position >= 0 ? (
                          <span className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                            {multiple ? (
                              position + 1
                            ) : (
                              <Check className="size-3.5" aria-hidden="true" />
                            )}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Pagination meta={data.meta} onPage={setPage} />
            </div>
          )}
        </QueryView>
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={busy || (!multiple && selected.length === 0)}
          >
            {busy ? 'Saving…' : 'Use selection'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
