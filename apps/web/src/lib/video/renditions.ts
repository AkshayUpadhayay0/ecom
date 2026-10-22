import type { PublicVideoSourceDto } from '@urban-ibile/shared';

export interface RenditionContext {
  viewportWidth: number;
  /** Slow connection or data-saver: take the smallest file. */
  constrained: boolean;
}

/** Viewports up to this width (CSS px) get the 480p file; wider ones get 720p or better. */
const SMALL_VIEWPORT_MAX = 768;
/** Large desktop screens may take the largest rendition (1080p) when the connection is fine. */
const LARGE_VIEWPORT_MIN = 1600;

function shortSide(source: PublicVideoSourceDto): number {
  if (source.width && source.height) return Math.min(source.width, source.height);
  const fromLabel = Number.parseInt(source.label, 10);
  return Number.isFinite(fromLabel) ? fromLabel : 0;
}

/**
 * Picks the MP4 rendition for the viewport and connection. Sources are ranked by their short side
 * (so portrait and landscape files compare fairly). Never returns undefined for a non-empty list.
 */
export function pickRendition(
  sources: readonly PublicVideoSourceDto[],
  context: RenditionContext,
): PublicVideoSourceDto | undefined {
  const ranked = [...sources].sort((a, b) => shortSide(a) - shortSide(b));
  if (ranked.length === 0) return undefined;
  if (context.constrained || context.viewportWidth <= SMALL_VIEWPORT_MAX) return ranked[0];
  if (context.viewportWidth >= LARGE_VIEWPORT_MIN) return ranked[ranked.length - 1];
  return ranked[Math.min(1, ranked.length - 1)];
}
