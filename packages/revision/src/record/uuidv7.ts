/**
 * An RFC 9562 version 7 UUID: a 48-bit Unix timestamp in milliseconds, then random bits, so ids
 * sort in the order they were minted. A review's id is minted when its item is presented.
 * `random` (at least 10 bytes) can be passed in, so tests are deterministic.
 */
export function uuidv7(
  now: Date,
  random: Uint8Array = crypto.getRandomValues(new Uint8Array(10)),
): string {
  if (random.length < 10) throw new Error("uuidv7 needs 10 random bytes");
  const bytes = new Uint8Array(16);
  let ms = now.getTime();
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes.set(random.subarray(0, 10), 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
