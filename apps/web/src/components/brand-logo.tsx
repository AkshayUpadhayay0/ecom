import { BRAND_NAME } from '@/brand/brand';

/**
 * TEMP: text stand-in for the logo. The real logo files are NOT wired in yet: the client's
 * supplied variants (wordmark / icon / seal) are waiting for approval of where each one is used.
 * Replace the body of this component only; callers do not change.
 */
export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display text-xl font-semibold tracking-tight ${className}`}>
      {BRAND_NAME}
    </span>
  );
}
