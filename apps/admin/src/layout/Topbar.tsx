import { ChevronDown, LogOut, Menu, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/features/auth/auth-context';
import type { Theme } from '@/lib/preferences';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const ROLE_LABELS = { super_admin: 'Super admin', admin: 'Admin' } as const;

interface TopbarProps {
  onOpenMenu: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Topbar({ onOpenMenu, theme, onToggleTheme }: TopbarProps) {
  const { admin, logout } = useAuth();
  if (!admin) return null;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMenu}
        aria-label="Open navigation menu"
      >
        <Menu />
      </Button>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-lg py-1.5 pr-2 pl-1.5 text-left hover:bg-muted"
            >
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold ring-1 ring-accent/40"
              >
                {initials(admin.displayName)}
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-sm leading-tight font-medium">
                  {admin.displayName}
                </span>
                <span className="block truncate text-xs leading-tight text-muted-foreground">
                  {admin.email}
                </span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Account menu</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{admin.displayName}</p>
              <p className="truncate text-xs font-normal text-muted-foreground">{admin.email}</p>
              <p className="mt-1 text-xs font-normal text-muted-foreground">
                {ROLE_LABELS[admin.role]}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout();
              }}
            >
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
