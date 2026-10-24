import { AlertTriangle, RotateCw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function ErrorState({
  what,
  onRetry,
  detail,
}: {
  what: string;
  onRetry: () => void;
  /** The real, plain-language cause when we know it (offline, API unreachable, ...). */
  detail?: string | undefined;
}) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive-soft">
        <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium">Couldn’t load {what}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {detail ?? 'Check your connection and try again.'}
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}
