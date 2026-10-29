/**
 * What a rejected HTMLMediaElement.play() means. Only NotAllowedError is the browser refusing to
 * autoplay. AbortError ("interrupted by a call to pause() / a new load request") is what happens
 * when WE unload the video while it is still starting (React StrictMode in development mounts,
 * unmounts and remounts it; scrolling takes a play slot away): that is not a refusal and must
 * never turn autoplay off for the card.
 */
export function isAutoplayBlocked(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotAllowedError'
  );
}
