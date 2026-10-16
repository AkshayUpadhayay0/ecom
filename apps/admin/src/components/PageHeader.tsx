import { useEffect, type ReactNode } from 'react';

/** Page title (also sets document.title), description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Urban Ibile Admin`;
  }, [title]);
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-sm text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="font-display text-3xl tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** Neutral information banner (pending client decisions, MOCK/SAMPLE notices). */
export function InfoBanner({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'info' | 'warning';
}) {
  return (
    <div
      role="note"
      className={
        tone === 'warning'
          ? 'rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-foreground'
          : 'rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-sm text-foreground'
      }
    >
      {children}
    </div>
  );
}
