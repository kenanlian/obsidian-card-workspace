/**
 * Deterministic PRNG and hashing utilities for the search benchmark fixtures.
 *
 * The benchmark must produce byte-identical fixtures on every machine and Node
 * version, so the generator avoids `Math.random` entirely and uses integer-only
 * arithmetic (`Math.imul`, `>>>`), which is stable across platforms.
 */

export type DeterministicRandom = () => number;

/** mulberry32: small, fast, seedable 32-bit PRNG. */
export function createDeterministicRandom(seed: number): DeterministicRandom {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function nextInt(
  random: DeterministicRandom,
  minInclusive: number,
  maxInclusive: number,
): number {
  if (maxInclusive < minInclusive) {
    throw new Error(`nextInt requires min <= max (got ${minInclusive} > ${maxInclusive}).`);
  }
  return minInclusive + Math.floor(random() * (maxInclusive - minInclusive + 1));
}

export function pickFrom<T>(random: DeterministicRandom, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("pickFrom requires a non-empty list.");
  }
  const index = Math.floor(random() * items.length) % items.length;
  return items[index] as T;
}

export interface StreamingHash32 {
  update(text: string): void;
  digest(): string;
}

/** FNV-1a 32-bit, streamed so multi-megabyte fixtures never get concatenated twice. */
export function createFnv1a32Hash(): StreamingHash32 {
  let hash = 0x811c9dc5;
  return {
    update(text: string): void {
      for (let index = 0; index < text.length; index += 1) {
        hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
      }
    },
    digest(): string {
      return (hash >>> 0).toString(16).padStart(8, "0");
    },
  };
}

export function fnv1a32Text(text: string): string {
  const hash = createFnv1a32Hash();
  hash.update(text);
  return hash.digest();
}
