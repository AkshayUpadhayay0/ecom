import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MEDIA_MIME_TYPES } from '@urban-ibile/shared';
import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UploadProgress } from '@/components/UploadProgress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { catalogKeys } from '@/features/products/products.queries';
import { catalogApi } from '@/lib/api/catalog';
import {
  RECOMMENDED_VIDEO,
  assetRefetchInterval,
  checkFile,
  readVideoDuration,
  uploadPublicFile,
  type FileCheck,
  type UploadStage,
} from '@/lib/media-upload';
import { errorMessage } from '@/lib/notify';
import { useMediaLimits } from '@/lib/use-media-limits';

const BYTES_PER_MB = 1024 * 1024;
const ACCEPT = Object.keys(MEDIA_MIME_TYPES).join(',');

type Phase = 'choose' | UploadStage | 'sent';

const formatMb = (bytes: number): string => `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;

/** What the worker is doing, in words an editor understands. */
function processingText(status: string | undefined, playable: boolean): string {
  if (status === 'ready') return 'Ready: every size is complete and the shop shows it.';
  if (status === 'failed' && playable) {
    return 'Playable with a warning: the shop shows it, but some sizes could not be made.';
  }
  if (status === 'failed') return 'Processing failed.';
  if (playable) return 'Playable: the shop already shows it. The other sizes are still being made.';
  if (status === 'processing') {
    return 'Processing: making the web versions (poster, preview and sizes).';
  }
  return 'Uploaded. Waiting for the background worker to pick it up.';
}

/**
 * Upload dialog with real progress: the browser's own upload percentage, then the worker's
 * Queued, Processing, Ready or Failed (with the reason), followed live without a refresh.
 */
export function UploadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const limits = useMediaLimits();
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [temporary, setTemporary] = useState(false);
  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState({ sent: 0, total: 0 });
  const [assetId, setAssetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const chosenFile = useRef<File | null>(null);

  // After the upload the worker takes over: follow it (2 s slowing to 10 s) until it is ready or
  // failed. No refresh needed; polling pauses in a hidden tab and stops when the dialog unmounts.
  const asset = useQuery({
    queryKey: ['catalog', 'media-asset', assetId],
    queryFn: () => catalogApi.mediaAsset(assetId ?? ''),
    enabled: assetId !== null,
    refetchInterval: assetRefetchInterval,
  });
  const status = asset.data?.status;
  const finished = status === 'ready' || status === 'failed';
  const playable = Boolean(asset.data?.playableAt);
  const notified = useRef(false);
  useEffect(() => {
    if (finished && !notified.current) {
      notified.current = true;
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    }
  }, [finished, queryClient]);
  // The moment it becomes playable the shop shows it: refresh the lists once.
  useEffect(() => {
    if (playable) void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
  }, [playable, queryClient]);

  function reset() {
    setFile(null);
    setCheck(null);
    setPhase('choose');
    setProgress({ sent: 0, total: 0 });
    setAssetId(null);
    setError(null);
    notified.current = false;
  }

  function choose(chosen: File | null) {
    chosenFile.current = chosen;
    setFile(chosen);
    setError(null);
    if (!chosen) {
      setCheck(null);
      return;
    }
    // Size and type are checked at once; the length (a soft warning) follows when it can be read.
    setCheck(checkFile(chosen, limits, null));
    void readVideoDuration(chosen).then((duration) => {
      if (duration !== null && chosenFile.current === chosen) {
        setCheck(checkFile(chosen, limits, duration));
      }
    });
  }

  async function submit() {
    if (!file || !check?.ok) return;
    setError(null);
    abort.current = new AbortController();
    try {
      const created = await uploadPublicFile(
        file,
        {
          onStage: setPhase,
          onProgress: (sent, total) => setProgress({ sent, total }),
          signal: abort.current.signal,
        },
        { temporary },
      );
      setAssetId(created.id);
      setPhase('sent');
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
    } catch (err) {
      setError(errorMessage(err));
      setPhase('choose');
    }
  }

  const uploading = phase === 'preparing' || phase === 'uploading' || phase === 'verifying';
  const choosing = phase === 'choose';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (uploading) return; // stop an upload with its own button
        onOpenChange(o);
        if (!o && (finished || choosing)) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload media</DialogTitle>
          <DialogDescription>
            The file goes straight to storage; the server then checks its size, type and content
            before processing it.
          </DialogDescription>
        </DialogHeader>

        {choosing ? (
          <>
            <Field
              label="File"
              required
              hint={`Videos: MP4, MOV, WebM (up to ${formatMb(limits.maxVideoBytes)}). Images: JPEG, PNG, WebP (up to ${formatMb(limits.maxImageBytes)}).`}
            >
              <input
                type="file"
                accept={ACCEPT}
                onChange={(e) => {
                  choose(e.target.files?.[0] ?? null);
                }}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
              />
            </Field>
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium">Recommended video:</span> {RECOMMENDED_VIDEO}
            </p>
            {file ? (
              <p className="text-xs text-muted-foreground">
                {file.name} · {formatMb(file.size)} · {file.type || 'unknown type'}
              </p>
            ) : null}
            {check?.problem ? (
              <p
                role="alert"
                className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
              >
                {check.problem}
              </p>
            ) : null}
            {check?.warnings.map((warning) => (
              <p
                key={warning}
                role="status"
                className="rounded-md bg-warning-soft px-3 py-2 text-xs"
              >
                {warning}
              </p>
            ))}
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={temporary}
                  onChange={(e) => setTemporary(e.target.checked)}
                />
                Temporary (to be replaced later)
              </label>
            </div>
          </>
        ) : (
          <div className="space-y-3" aria-live="polite">
            <p className="text-sm font-medium">
              {file?.name}{' '}
              <span className="font-normal text-muted-foreground">
                ({file ? formatMb(file.size) : ''})
              </span>
            </p>
            {uploading ? (
              <>
                {phase === 'preparing' ? <p className="text-sm">Preparing the upload…</p> : null}
                {phase === 'uploading' ? (
                  <>
                    <p className="text-sm">Uploading… keep this page open.</p>
                    <UploadProgress
                      sent={progress.sent}
                      total={progress.total || (file?.size ?? 0)}
                    />
                  </>
                ) : null}
                {phase === 'verifying' ? <p className="text-sm">Checking the file…</p> : null}
              </>
            ) : (
              <>
                <UploadProgress
                  sent={file?.size ?? 0}
                  total={file?.size ?? 0}
                  label="Upload complete"
                />
                <p className="flex items-center gap-2 text-sm">
                  {status === 'ready' ? (
                    <Badge tone="success">Ready</Badge>
                  ) : status === 'failed' && playable ? (
                    <Badge tone="warning">Playable, with a warning</Badge>
                  ) : status === 'failed' ? (
                    <Badge tone="danger">Failed</Badge>
                  ) : playable ? (
                    <Badge tone="success">Playable</Badge>
                  ) : (
                    <Badge tone="warning">
                      {status === 'processing' ? 'Processing' : 'Queued'}
                    </Badge>
                  )}
                  <span role="status">{processingText(status, playable)}</span>
                </p>
                {status === 'failed' && !playable ? (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
                  >
                    {asset.data?.processingError ?? 'The file could not be processed.'} Upload a
                    different file, or open it in the library and choose Retry.
                  </p>
                ) : null}
                {status === 'failed' && playable ? (
                  <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm">
                    {asset.data?.processingError} Open it in the library and choose Retry to make
                    the missing sizes.
                  </p>
                ) : null}
                {!finished ? (
                  <p className="text-xs text-muted-foreground">
                    You can close this window: processing continues in the background and the
                    library updates by itself.
                  </p>
                ) : null}
              </>
            )}
          </div>
        )}

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {uploading ? (
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              Cancel upload
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                if (finished || choosing) reset();
              }}
            >
              {choosing ? 'Cancel' : finished ? 'Done' : 'Close'}
            </Button>
          )}
          {finished ? (
            <Button variant="outline" onClick={reset}>
              Upload another
            </Button>
          ) : null}
          {choosing ? (
            <Button onClick={() => void submit()} disabled={!file || !check?.ok} aria-live="polite">
              <Upload aria-hidden="true" /> Upload
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
