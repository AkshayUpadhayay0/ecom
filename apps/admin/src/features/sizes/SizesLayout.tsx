import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';

export const SIZES_PATHS = {
  charts: '/sizes/charts',
  profiles: '/sizes/profiles',
  sizes: '/sizes',
} as const;

const TABS = [
  { label: 'Size Charts', to: SIZES_PATHS.charts },
  { label: 'Measurement Profiles', to: SIZES_PATHS.profiles },
  // `end`: /sizes must not stay active on /sizes/charts.
  { label: 'Sizes', to: SIZES_PATHS.sizes, end: true },
] as const;

/** "Sizes & Charts" section: shared heading + sub-tabs; each tab renders in the outlet. */
export function SizesLayout() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Sizes &amp; Charts</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The size charts, measurement profiles and sizes Blueprint uses to recommend a size. All
          values are in inches.
        </p>
      </div>

      <nav aria-label="Sizes and charts sections" className="-mx-1 overflow-x-auto border-b">
        <ul className="flex min-w-max gap-1 px-1">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={'end' in tab ? tab.end : false}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <Outlet />
    </div>
  );
}
