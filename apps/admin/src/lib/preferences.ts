import { useCallback, useEffect, useState } from 'react';

/**
 * UI preferences only (theme, sidebar). Never store tokens or personal data here.
 * Storage can be unavailable (private mode, blocked storage), so every access is guarded.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference simply is not remembered.
  }
}

export type Theme = 'light' | 'dark';
const THEME_KEY = 'ui-admin-theme'; // also read by the inline script in index.html
const SIDEBAR_KEY = 'ui-admin-sidebar-collapsed';

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => (read(THEME_KEY) === 'dark' ? 'dark' : 'light'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    write(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme };
}

export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => read(SIDEBAR_KEY) === 'true');
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      write(SIDEBAR_KEY, String(!current));
      return !current;
    });
  }, []);
  return [collapsed, toggle];
}
