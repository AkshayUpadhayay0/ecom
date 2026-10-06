import { Wordmark } from './Wordmark';

export function FullPageLoader() {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background"
      role="status"
      aria-live="polite"
    >
      <Wordmark className="text-3xl" />
      <div className="h-0.5 w-24 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[loader_1.1s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>
      <span className="sr-only">Loading…</span>
      <style>
        {'@keyframes loader{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}
      </style>
    </div>
  );
}
