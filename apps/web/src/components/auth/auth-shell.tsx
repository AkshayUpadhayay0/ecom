import type { ReactNode } from 'react';

/** Narrow centred column used by every account form page. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="mb-6 text-3xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}
