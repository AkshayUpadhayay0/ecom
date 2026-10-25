import { useEffect, useRef, type RefObject } from 'react';

/** The element inside a dialog that should take focus when it opens (e.g. a search field). */
const AUTOFOCUS_SELECTOR = '[data-autofocus]';

/**
 * Opens and closes a native <dialog> as modal from an `open` flag. The browser traps focus inside,
 * closes on Esc and returns focus to the opener. A click on the backdrop (it lands on the dialog
 * element itself, not on its content) also calls `onClose`.
 */
export function useModalDialog(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>(AUTOFOCUS_SELECTOR)?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onClick = (event: MouseEvent): void => {
      if (event.target === element) onClose();
    };
    element.addEventListener('click', onClick);
    return () => {
      element.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return ref;
}
