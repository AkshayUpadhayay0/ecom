import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

export interface SectionTab {
  label: string;
  to: string;
  /** Exact match only (a parent path must not stay active on its children). */
  end?: boolean;
}

/** Sub-navigation under a page title (same look as Sizes & Charts). */
export function SectionTabs({ label, tabs }: { label: string; tabs: readonly SectionTab[] }) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((tab) => (
          <li key={tab.to}>
            <NavLink
              to={tab.to}
              end={tab.end ?? false}
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
  );
}
