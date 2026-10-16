import { useId, type ReactElement, type ReactNode } from 'react';
import { cloneElement } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface FieldProps {
  label: string;
  /** The control (input / textarea / select). id and aria attributes are wired automatically. */
  children: ReactElement<Record<string, unknown>>;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  className?: string;
}

/** Label + control + hint + error, with ids and aria-describedby connected. */
export function Field({ label, children, hint, error, required, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </Label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
