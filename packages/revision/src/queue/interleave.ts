/**
 * Interleaving (06-queue-ranker.md §7): from items in priority order, repeatedly take the first one
 * whose topic differs from the last one taken, or the first one when only repeats remain. Greedy
 * and priority-preserving; nothing is lost or duplicated. `lastTopic` is the topic just before
 * this list (an extension continues the plan). O(n²) on n ≤ ~60. Pure.
 */
export function interleave<T extends { topicKey: string }>(
  byPriority: readonly T[],
  lastTopic: string | null = null,
): T[] {
  const pool = [...byPriority];
  const result: T[] = [];
  let last = lastTopic;
  while (pool.length > 0) {
    const differs = pool.findIndex((item) => item.topicKey !== last);
    const [next] = pool.splice(differs === -1 ? 0 : differs, 1);
    if (next === undefined) break;
    result.push(next);
    last = next.topicKey;
  }
  return result;
}
