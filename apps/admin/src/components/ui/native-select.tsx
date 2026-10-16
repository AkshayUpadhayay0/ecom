import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Styled native <select>: fully keyboard- and screen-reader-accessible out of the box, and
 * works well on tablets (native picker).
 */
export function NativeSelect({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className={cn(
          'h-10 w-full appearance-none rounded-md border border-input bg-card pr-9 pl-3 text-sm shadow-xs',
          'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}
