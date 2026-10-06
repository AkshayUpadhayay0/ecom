import { NavLink } from 'react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav-items';

interface SidebarNavProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {NAV_ITEMS.map(({ label, path, icon: Icon, comingSoon }) => {
          const link = (
            <NavLink
              to={path}
              onClick={onNavigate}
              aria-label={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive
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
    </nav>
  );
}
