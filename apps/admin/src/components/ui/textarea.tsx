import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-24 w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-[0.9375rem] shadow-xs transition-[border-color,box-shadow] placeholder:text-muted-foreground/70',
        'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/25',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}
