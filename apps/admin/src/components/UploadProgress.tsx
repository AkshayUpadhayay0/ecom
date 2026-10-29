/** A real progress bar (percentage from the browser's upload events). */
export function UploadProgress({
  sent,
  total,
  label = 'Upload progress',
}: {
  sent: number;
  total: number;
  label?: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
  const megabytes = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(1);
  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="off">
        {percent}% · {megabytes(sent)} of {megabytes(total)} MB
      </p>
    </div>
  );
}
