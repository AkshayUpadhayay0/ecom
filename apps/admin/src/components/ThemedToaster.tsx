import { useSyncExternalStore } from 'react';
import { Toaster } from 'sonner';

/** Follows the app theme (the `dark` class on <html>, toggled in the top bar). */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => {
    observer.disconnect();
  };
}

const isDark = () => document.documentElement.classList.contains('dark');

export function ThemedToaster() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return <Toaster theme={dark ? 'dark' : 'light'} position="top-right" richColors closeButton />;
}
