import { cn } from '@/lib/utils';

/** Typographic wordmark (TEMP until the client supplies a logo file). */
export function Wordmark({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        'font-display font-medium tracking-[-0.02em] [font-variation-settings:"opsz"_144,"SOFT"_50]',
        className,
      )}
    >
      {compact ? (
        <>
          U<span className="text-accent">.</span>I
        </>
      ) : (
        <>
          Urban <em className="font-normal italic">Ibile</em>
        </>
      )}
    </span>
  );
}
