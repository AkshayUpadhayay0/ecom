'use client';

import { useEffect } from 'react';
import { restoreDrafts } from '@/lib/i18n/drafts';

/** Puts back form values saved just before a language switch (see lib/i18n/drafts.ts). */
export function DraftRestorer() {
  useEffect(() => restoreDrafts(), []);
  return null;
}
