import { Wordmark } from '@/components/Wordmark';

/**
 * Editorial brand panel for the login screen: layered gradients and abstract line artwork
 * (concentric arcs + a woven grid, a quiet nod to textile pattern). No photography.
 * Colours come from the --brand-* theme variables (TEMP palette).
 */
export function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-brand-ink text-brand-text lg:flex lg:flex-col lg:justify-between">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 85% 10%, color-mix(in oklch, var(--brand-glow) 45%, transparent) 0%, transparent 55%),' +
            'radial-gradient(90% 70% at 0% 100%, color-mix(in oklch, var(--brand-ink-2) 90%, transparent) 0%, transparent 60%)',
        }}
      />
      <svg
        aria-hidden="true"
        className="absolute -right-24 bottom-[-10%] h-[85%] w-auto opacity-70"
        viewBox="0 0 600 600"
        fill="none"
      >
        <defs>
          <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand-line)" stopOpacity="0.9" />
            <stop offset="1" stopColor="var(--brand-line)" stopOpacity="0.05" />
          </linearGradient>
          <pattern id="weave" width="22" height="22" patternUnits="userSpaceOnUse">
            <path d="M0 11h22M11 0v22" stroke="var(--brand-line)" strokeOpacity="0.08" />
          </pattern>
        </defs>
        <rect width="600" height="600" fill="url(#weave)" />
        {[260, 220, 180, 140, 100, 60].map((r, index) => (
          <circle
            key={r}
            cx="330"
            cy="330"
            r={r}
            stroke="url(#arc)"
            strokeWidth={index === 0 ? 1.5 : 1}
            strokeDasharray={index % 2 === 0 ? undefined : '2 7'}
          />
        ))}
        <path d="M40 520 C 200 380, 380 600, 560 300" stroke="url(#arc)" strokeWidth="1.2" />
        <path d="M20 440 C 220 300, 360 520, 580 220" stroke="url(#arc)" strokeWidth="0.8" />
      </svg>

      <div className="relative z-10 p-12 xl:p-16">
        <Wordmark className="text-3xl" />
        <p className="mt-2 text-xs tracking-[0.3em] text-brand-text/60 uppercase">Admin studio</p>
      </div>

      <div className="relative z-10 max-w-md p-12 xl:p-16">
        <p className="font-display text-4xl leading-[1.1] font-light tracking-tight xl:text-5xl">
          Curate the collection.
          <br />
          <span className="italic text-brand-line">Keep every order moving.</span>
        </p>
        <p className="mt-6 text-sm leading-relaxed text-brand-text/65">
          Products, stock, content and orders for the Urban Ibile website and app, in one place.
        </p>
        <p className="mt-12 text-xs text-brand-text/40">© {new Date().getFullYear()} Urban Ibile</p>
      </div>
    </aside>
  );
}
