/**
 * Seeded RNG.
 *
 * The generator, the offseason, and the League Lab all draw from a plain
 * function source. That makes a universe impossible to reproduce: regenerate
 * twice and you get two different leagues, so there is no baseline to compare a
 * model change against. mulberry32 is tiny, fast, and good enough for a
 * simulator, so a seed becomes enough to pin a universe down exactly.
 */

/** mulberry32: 32-bit state, uniform enough for simulation, no dependencies. */
export const createSeededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Turns user input into a usable seed. Blank or nonsense input becomes a fixed
 * default rather than NaN, so a typo can't silently produce a degenerate
 * universe.
 */
export const normalizeSeed = (value: string | number | null | undefined, fallback = 1337): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(Math.trunc(value)) >>> 0;
  }
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (Number.isFinite(parsed)) {
    return Math.abs(parsed) >>> 0;
  }
  return fallback;
};
