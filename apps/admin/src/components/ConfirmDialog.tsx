import { useState, type ReactNode } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/notify';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Shows a required (or optional) text box; its value is passed to onConfirm. */
  note?: { label: string; required: boolean; placeholder?: string; hint?: ReactNode };
  /** Extra fields / warnings above the note. */
  children?: ReactNode;
  /** Resolves on success (dialog closes); a rejection keeps it open and shows the message. */
  onConfirm: (note: string) => Promise<unknown>;
  /** Disable the confirm button (e.g. extra fields invalid). */
  confirmDisabled?: boolean;
}

/** Confirmation step for writes; errors from the API are shown inside the dialog. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  note,
  children,
  onConfirm,
  confirmDisabled,
}: ConfirmDialogProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteMissing = note?.required === true && text.trim() === '';

  function close(next: boolean) {
    if (busy) return;
    if (!next) {
      setText('');
      setError(null);
    }
    onOpenChange(next);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(text.trim());
      setText('');
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {note ? (
          <Field label={note.label} required={note.required} hint={note.hint}>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={note.placeholder}
              maxLength={2000}
            />
          </Field>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void confirm()}
            disabled={busy || noteMissing || confirmDisabled === true}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
