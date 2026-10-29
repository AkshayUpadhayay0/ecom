/**
 * Runs `work` for every item with at most `limit` running at once; resolves with the results in the
 * order of `items`. The first failure rejects (items already running finish, nothing new starts).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  async function lane(): Promise<void> {
    while (!failed) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await work(items[index] as T, index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const lanes = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
