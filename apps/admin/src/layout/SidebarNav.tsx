import { NavLink, useLocation } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsSuperAdmin } from '@/features/auth/roles';
import { cn } from '@/lib/utils';
import { navItemsFor, type NavItem } from './nav-items';

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

function isUnderPrefix(pathname: string, prefix: string | undefined): boolean {
  return prefix !== undefined && (pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const items = navItemsFor(useIsSuperAdmin());
  const main = items.filter((item) => item.group === 'main');
  const internal = items.filter((item) => item.group === 'internal');
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      <NavList items={main} collapsed={collapsed} onNavigate={onNavigate} />
      {internal.length > 0 ? (
        <section aria-labelledby="nav-internal" className="mt-6 border-t pt-4">
          <h2
            id="nav-internal"
            className={cn(
              'mb-2 px-3 text-[0.6875rem] font-medium tracking-wide text-sidebar-foreground/55 uppercase',
              collapsed && 'sr-only',
            )}
          >
            Internal
          </h2>
          <NavList items={internal} collapsed={collapsed} onNavigate={onNavigate} />
        </section>
      ) : null}
    </nav>
  );
}

function NavList({
  items,
  collapsed,
  onNavigate,
}: {
  items: readonly NavItem[];
  collapsed: boolean;
  onNavigate: (() => void) | undefined;
}) {
  const { pathname } = useLocation();
  return (
    <ul className="space-y-1">
      {items.map(({ label, path, icon: Icon, comingSoon, activePrefix }) => {
        const link = (
          <NavLink
            to={path}
            onClick={onNavigate}
            aria-label={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                isActive || isUnderPrefix(pathname, activePrefix)
                  ? 'bg-sidebar-active text-sidebar-active-foreground shadow-sm'
                  : 'text-sidebar-foreground/75 hover:bg-muted hover:text-sidebar-foreground',
              )
            }
          >
            <Icon className="size-[1.125rem] shrink-0" aria-hidden="true" />
            {collapsed ? null : (
              <>
                <span className="truncate">{label}</span>
                {comingSoon ? (
                  <span className="ml-auto rounded-full border border-current/15 px-1.5 py-px text-[0.625rem] tracking-wide uppercase opacity-60">
                    Soon
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        );
        return (
          <li key={path}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">
                  {label}
                  {comingSoon ? ' · Coming soon' : ''}
                </TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}
