'use client';

import { useEffect } from 'react';
import { useMediaPreferences } from '@/lib/video/use-media-preferences';

/**
 * Mirrors the visitor's Save-Data / slow-connection preference onto <html data-save-data>, so CSS
 * can switch off decorative motion (globals.css) the same way it does for reduced motion.
 */
export function MotionPreferences() {
  const { saveData } = useMediaPreferences();
  useEffect(() => {
    const root = document.documentElement;
    if (saveData) root.dataset.saveData = 'true';
    else delete root.dataset.saveData;
  }, [saveData]);
  return null;
}
