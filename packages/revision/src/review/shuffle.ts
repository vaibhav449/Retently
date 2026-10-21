/**
 * The same items in an order decided by `seed`: Fisher–Yates driven by mulberry32, seeded with the
 * FNV-1a hash of the string. MCQ options are shuffled at every presentation, seeded by its review
 * id, so the stored order teaches nothing ("the answer is usually B") and one presentation always
 * shows one order. The input is not changed.
 */
export function shuffleBySeed<T>(items: readonly T[], seed: string): T[] {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  let state = hash | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const a = shuffled[i] as T;
    const b = shuffled[j] as T;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return shuffled;
}
