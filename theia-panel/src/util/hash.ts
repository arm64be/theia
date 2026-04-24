/** FNV-1a 32-bit hash of a string, returned as unsigned integer. */
export function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

/** Hash a string to [0, 1). */
export function hash01(str: string): number {
  return (fnv1a(str) % 1000) / 1000;
}

/** Hash a string to [-1, 1]. */
export function hashN11(str: string): number {
  return hash01(str) * 2 - 1;
}
