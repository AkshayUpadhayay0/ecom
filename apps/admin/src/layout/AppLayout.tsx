import { KeyRound, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/auth-context';
import { useSidebarCollapsed, useTheme } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { SidebarNav } from './SidebarNav';
import { Topbar } from './Topbar';

function PasswordChangeBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-warning/30 bg-warning-soft px-4 py-3 text-sm sm:px-6"
    >
      <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p>
        <span className="font-medium">You must change your password.</span> Until you do, admin
        actions will be blocked. A change-password screen is coming in the next update.
      </p>
    </div>
  );
}

export function AppLayout() {
  const { admin } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-dvh bg-background">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to content
        </a>

        {/* Desktop sidebar */}
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex',
            collapsed ? 'w-[4.75rem]' : 'w-64',
          )}
        >
          <div className={cn('flex h-16 items-center px-5', collapsed && 'justify-center px-0')}>
            <Link to="/dashboard" aria-label="Urban Ibile admin home">
              <Wordmark className="text-xl" compact={collapsed} />
            </Link>
          </div>
          <SidebarNav collapsed={collapsed} />
          <div
            className={cn('border-t border-sidebar-border p-3', collapsed && 'flex justify-center')}
          >
            <Button
              variant="ghost"
              size={collapsed ? 'icon' : 'sm'}
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              className={cn(!collapsed && 'w-full justify-start text-muted-foreground')}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              {collapsed ? null : 'Collapse'}
            </Button>
          </div>
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent>
            <div className="flex h-16 items-center px-5">
              <SheetTitle asChild>
                <span>
                  <Wordmark className="text-xl" />
                </span>
              </SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
            </div>
            <SidebarNav
              onNavigate={() => {
                setMobileOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            onOpenMenu={() => {
              setMobileOpen(true);
            }}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
          {admin?.mustChangePassword ? <PasswordChangeBanner /> : null}
          <main
            id="main"
            tabIndex={-1}
            className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-8"
          >
            <div className="mx-auto w-full max-w-7xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
