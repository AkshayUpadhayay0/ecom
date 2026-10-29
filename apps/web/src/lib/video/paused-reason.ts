import type { MediaPreferences } from './use-media-preferences';
import type { PausedReason } from './video-notice';

/**
 * Why a video shows its poster instead of playing, for the small page notice. Shared by the shop
 * cards and the product page so both explain the same way. null = nothing to explain (it plays, or
 * the visitor already tapped play).
 */
export function pausedReasonFor(
  prefs: MediaPreferences,
  state: { hasVideo: boolean; tapped: boolean; blocked: boolean },
): PausedReason | null {
  if (!state.hasVideo || state.tapped) return null;
  if (prefs.reducedMotion) return 'reduced_motion';
  if (prefs.constrainedKind === 'save_data') return 'save_data';
  if (prefs.constrainedKind === 'slow') return 'slow';
  return state.blocked ? 'autoplay_blocked' : null;
}
