/**
 * Turning a club's official colours into something that can actually be drawn on this app's
 * surfaces.
 *
 * WHY THIS MODULE EXISTS. `teamColors.ts` holds real uniforms. This app's surfaces are dark
 * navy -- `--color-panel` #161d2e at luma 29, `--color-sunken` #0b1120 at 13 -- and club primary
 * luma runs from 27 (`urb`) to 255 (`loy`), mean 110. The two ranges barely overlap. Measured
 * against `--color-panel`, three clubs' primary is under 1.2:1 and would be *invisible* as a rule:
 * `ock` 1.04, `urb` 1.03, `dwi` 1.14. Eighteen others read over 3:1 and would be a glaring bar.
 *
 * So `primary` is the club's identity and is emphatically not the value that gets drawn. Every
 * render path goes through `clubInk`, which lifts a colour into the legible band while holding its
 * hue. That is what lets all 32 clubs get the same treatment instead of the light ones getting the
 * good version and the dark ones getting nothing.
 *
 * THE RULE THAT OVERRIDES EVERY COLOUR IN THIS FILE:
 *
 *   Club colour never carries meaning. It may decorate. It may never be the only thing
 *   distinguishing one state from another.
 *
 * Measured reason, not taste: 28 club slots sit within CIE Lab dE 12 of a semantic token in this
 * design system. Sinope's primary #0cb3a9 is dE 3.4 from `--color-neutral`; Arsagam's #fb096b is
 * dE 5.5 from `--color-neg`; Garsollo's secondary is dE 7.5 from `--color-pos`. A red tint that
 * means "this club" and a red tint that means "you lost money" cannot share a pixel. So gold stays
 * gold for elite OVR, `--color-pos` stays green for a winning prop, and this module is only ever
 * asked for surfaces that carry no meaning of their own.
 *
 * Nothing here reads or writes the DOM. Every function is pure and takes its surface as an
 * argument, because "does this colour work" has no answer until you name the surface -- and a
 * function that hardcoded `--color-panel` would answer a different question than the one asked of it
 * on a sunken or chrome background.
 */

import { PALETTE_SLOTS, teamColors, type PaletteSlot, type TeamId } from '../data/teamColors';

/* ------------------------------------------------------------------ colour space */

/** sRGB hex to linear-light 0-1 triple. */
const toLinear = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4)];
};

/** Linear-light to sRGB hex, with the transfer function applied and clamped. */
const toHex = (rgb: [number, number, number]): string => {
  const encode = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  return `#${encode(rgb[0])}${encode(rgb[1])}${encode(rgb[2])}`;
};

type Oklab = { L: number; a: number; b: number };

/** linear sRGB -> OKLab. Björn Ottosson's matrices. */
const linearToOklab = ([r, g, b]: [number, number, number]): Oklab => {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
};

/** OKLab -> linear sRGB. Inverse of the above. */
const oklabToLinear = ({ L, a, b }: Oklab): [number, number, number] => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

/** Chroma and hue in OKLCH. L is carried separately so it can be moved without touching them. */
type Oklch = { L: number; C: number; h: number };

const toOklch = (hex: string): Oklch => {
  const { L, a, b } = linearToOklab(toLinear(hex));
  return { L, C: Math.hypot(a, b), h: Math.atan2(b, a) };
};

const fromOklch = ({ L, C, h }: Oklch): string =>
  toHex(oklabToLinear({ L, a: C * Math.cos(h), b: C * Math.sin(h) }));

/**
 * Reduce chroma until the colour fits inside sRGB, by bisection.
 *
 * Pushing lightness up on a saturated colour eventually walks it out of the displayable gamut --
 * an OKLCH colour is a cylinder and sRGB is a cube inside it. Clipping the linear values instead
 * would shift the hue, which is the one thing this module must not do: a lifted Arsagam red that
 * drifted orange would be a different club's colour.
 *
 * Bisection rather than an analytic solve because the gamut boundary in OKLCH is not a simple
 * function and this runs once per club per render at most.
 */
const clampChromaToGamut = (L: number, C: number, h: number): number => {
  const fits = (c: number) => {
    const [r, g, b] = oklabToLinear({ L, a: c * Math.cos(h), b: c * Math.sin(h) });
    const eps = 1e-4;
    return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
  };
  if (fits(C)) return C;
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
};

/* ------------------------------------------------------------------ measurement */

/**
 * WCAG relative luminance. This is the measure the floors below are expressed in.
 *
 * Distinct from OKLCH's `L`, which is a perceptual lightness on a different scale. Using the
 * perceptual one for the contrast test would be defensible and would give different numbers; WCAG
 * is used here because the floors are meant to be comparable to the 3:1 non-text figure everyone
 * already knows.
 */
export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = toLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, 1:1 to 21:1. */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

/* ------------------------------------------------------------------ the surfaces it is drawn on */

/**
 * The surfaces a club mark is actually drawn on, read from `src/index.css`.
 *
 * `panel` is the one that matters and the one every measurement in the header refers to.
 * `sunken` is the bench-unit inset, `panel3` the raised chrome, `base2` the bench-row fill.
 * All four are listed because a colour that clears one and not another is a colour that will look
 * right in a screenshot taken on one screen and wrong in the app.
 *
 * TWO PALETTES, because the postseason repaints these tokens (`html[data-season='postseason']` in
 * `index.css`). If this table kept only the navy values, `clubInk` would go on deriving against
 * `#161d2e` while the page underneath it is `#2a190d` -- a colour no longer on screen. The derived
 * inks would be *close*, because the autumn ramp is luminance-matched, and "close" is not a
 * guarantee. This module exists to make a guarantee, so it takes the theme as an argument.
 *
 * THE AUTUMN VALUES MUST STAY LUMINANCE-MATCHED. Measured: 30 of 32 club primaries are LIGHTER than
 * the surface, which is why `liftForContrast` raises lightness rather than lowering it. If the
 * autumn panel is brightened until primaries fall below it, that lift silently inverts and all 32
 * derived colours are wrong while still looking plausible. `tools/checkAutumnPalette.ts` asserts
 * the 30/32 count in both themes for exactly this reason.
 */
export const CLUB_SURFACES: Record<ClubTheme, Record<ClubSurface, string>> = {
  regular: {
    panel: '#161d2e',
    sunken: '#0b1120',
    panel3: '#232c42',
    base2: '#0d1322',
  },
  autumn: {
    panel: '#2a190d',
    sunken: '#1d0d04',
    panel3: '#3d2717',
    base2: '#1f0f05',
  },
};

export type ClubSurface = 'panel' | 'sunken' | 'panel3' | 'base2';

export type ClubTheme = 'regular' | 'autumn';

/** The surface colour for a theme. The one lookup every other function goes through. */
export const clubSurface = (surface: ClubSurface, theme: ClubTheme = 'regular'): string =>
  CLUB_SURFACES[theme][surface];

/**
 * The contrast a lifted club colour must clear against the surface underneath it.
 *
 * **This is a chosen number and is labelled as one.** 3.0 is the WCAG figure for non-text UI
 * components, and it is the defensible default for a rule a reader is meant to notice. Measured
 * consequence of choosing it: `urb` (#1b1b1a, chroma 0.004 -- effectively black) has to lift a long
 * way, and lands as a neutral grey, because there is no hue in it to preserve. That is the right
 * answer for a black club and it is why the fallback chain below exists at all.
 *
 * Dropping this to 1.2 would let near-black clubs keep their own value, at the cost of a rule that
 * stops registering as a rule on the ones that are genuinely dark.
 */
export const INK_CONTRAST_FLOOR = 3.0;

/**
 * Below this chroma a colour is grey and lifting it cannot "preserve" anything, so there is no
 * point pretending the fallback is preserving hue. Chosen, and it exists to make the fallback chain
 * decide rather than lift.
 */
export const MIN_MEANINGFUL_CHROMA = 0.02;

/* ------------------------------------------------------------------ derivation */

/**
 * Lift `source` until it clears `floor` against `surface`, holding hue.
 *
 * Lightness is walked upward in OKLCH and chroma is only ever reduced to stay inside sRGB, so the
 * hue angle is untouched by construction. 24 steps between the source and the white point is
 * finer than the display can show and is cheap; the loop exits as soon as the floor is met.
 */
const liftForContrast = (source: string, surface: string, floor: number): string => {
  const { L, C, h } = toOklch(source);
  // Already fine: return the club's own colour untouched. Eighteen of 32 primaries land here and
  // they should be recognisably the club's uniform, not a slightly lighter version of it.
  if (contrastRatio(source, surface) >= floor) return source;

  const steps = 24;
  for (let i = 1; i <= steps; i += 1) {
    const targetL = L + ((1 - L) * i) / steps;
    const candidate = fromOklch({ L: targetL, C: clampChromaToGamut(targetL, C, h), h });
    if (contrastRatio(candidate, surface) >= floor) return candidate;
  }
  // Unreachable for any surface in `CLUB_SURFACES`, all of which are dark: white clears 3:1
  // against every one. Returning white rather than throwing keeps a render path total, and the
  // check below would catch it if that stopped being true.
  return '#ffffff';
};

export interface ClubInk {
  /** The renderable colour. Guaranteed to clear `floor` against the surface asked for. */
  hex: string;
  /** Which slot actually got used. Measured, not assumed -- see `slot`. */
  slot: PaletteSlot;
  /** How far the value was lifted from the source, in OKLCH lightness. 0 means untouched. */
  lift: number;
  /** True when the primary could not carry it and a fallback slot did. */
  fellBack: boolean;
}

/**
 * The club's renderable colour for a surface.
 *
 * Tries the primary first, which eighteen clubs get untouched. A primary that is too dark to lift
 * without going grey falls through to secondary, then tertiary -- and says so in the result rather
 * than silently swapping, because "which slot is this actually" is the question that decides
 * whether the mark is recognisable.
 *
 * Returns null only for an id with no palette at all, which the `Record<TeamId, ...>` type makes
 * unreachable for a real club. The null is handled rather than thrown so a future caller that
 * passes a saved-but-unknown id renders a neutral mark instead of a blank panel.
 */
export const clubInk = (
  teamId: TeamId,
  surface: ClubSurface = 'panel',
  theme: ClubTheme = 'regular',
): ClubInk | null => {
  const palette = teamColors[teamId];
  if (!palette) return null;

  const against = clubSurface(surface, theme);
  for (const slot of PALETTE_SLOTS) {
    const source = palette[slot];
    const { C } = toOklch(source);
    const hex = liftForContrast(source, against, INK_CONTRAST_FLOOR);

    // Lifting a colour that has no hue in it is not preservation, it is replacement with grey. If
    // the source is grey AND we had to move it, let the next slot try -- a club's secondary may be
    // the one with actual colour in it.
    const moved = hex.toLowerCase() !== source.toLowerCase();
    if (slot === 'primary' && moved && C < MIN_MEANINGFUL_CHROMA) continue;

    return {
      hex,
      slot,
      lift: moved ? toOklch(hex).L - toOklch(source).L : 0,
      fellBack: slot !== 'primary',
    };
  }

  // Every slot was either unusable or grey-and-lifted. The tertiary is the last resort and is
  // taken regardless of chroma, because a grey club mark beats no club mark.
  const last = palette.tertiary;
  const hex = liftForContrast(last, against, INK_CONTRAST_FLOOR);
  return { hex, slot: 'tertiary', lift: toOklch(hex).L - toOklch(last).L, fellBack: true };
};

/**
 * A low-alpha version of the club colour, for fills.
 *
 * `color-mix` against the surface rather than an rgba alpha over it, because an alpha over a
 * *different* surface produces a different colour -- and these are drawn on three. Mixing in oklab
 * keeps the hue steady as it lightens; the codebase already uses this idiom at `index.css:620`.
 *
 * `amount` is the club colour's share, so 0.14 is "14% club, 86% surface".
 */
export const clubTint = (
  teamId: TeamId,
  amount: number,
  surface: ClubSurface = 'panel',
  theme: ClubTheme = 'regular',
): string => {
  const ink = clubInk(teamId, surface, theme);
  if (!ink) return clubSurface(surface, theme);
  const pct = Math.round(Math.min(1, Math.max(0, amount)) * 100);
  return `color-mix(in oklab, ${ink.hex} ${pct}%, ${clubSurface(surface, theme)})`;
};

/**
 * The tertiary, as a wash.
 *
 * Separate from `clubTint` because the tertiary is not interchangeable with the primary and the two
 * answer different questions. Measured: **12 of 32** tertiaries are *darker* than the panel they
 * sit on -- `des` and `fes` are `#000000`, `val` is `#060606` -- so for those clubs a wash is a
 * cooling of the surface rather than a tint, and the same percentage produces the opposite visual
 * weight. The other 20 are lighter, several of them pure white.
 *
 * That is precisely why tertiary is used for washes and never as a rule of its own: a wash works
 * whether the source is above or below the surface, a hairline does not.
 */
export const clubWash = (
  teamId: TeamId,
  amount: number,
  surface: ClubSurface = 'panel',
  theme: ClubTheme = 'regular',
): string => {
  const palette = teamColors[teamId];
  const against = clubSurface(surface, theme);
  if (!palette) return against;
  // Mixed toward the surface rather than lifted, so a dark tertiary darkens instead of being
  // dragged up to legibility -- it is a texture, not a mark, and forcing it to clear the floor is
  // what would make it shout.
  const pct = Math.round(Math.min(1, Math.max(0, amount)) * 100);
  return `color-mix(in oklab, ${palette.tertiary} ${pct}%, ${against})`;
};

/**
 * The 32 clubs' identity marks, resolved once for a surface and theme.
 *
 * For the screens that need many clubs at once. Memoised because a roster page re-renders on every
 * hover and this is pure arithmetic; the cost is 32 colour-space conversions and the alternative is
 * paying them per render, which is the exact defect that made the prop board lag.
 *
 * THE CACHE KEY MUST CARRY THE THEME. Keyed on the surface alone, the two themes return each
 * other's inks for the rest of the session -- the autumn page paints navy-derived colours and nothing
 * reports it, because the navy inks are perfectly valid, just for a background that is no longer
 * there. That is the same class of bug as the four guardrails in the handover: a plausible number
 * describing the wrong thing.
 */
const inkCache = new Map<string, Record<TeamId, ClubInk | null>>();

export const clubInks = (
  surface: ClubSurface = 'panel',
  theme: ClubTheme = 'regular',
): Record<TeamId, ClubInk | null> => {
  const key = `${theme}:${surface}`;
  const cached = inkCache.get(key);
  if (cached) return cached;
  const built = {} as Record<TeamId, ClubInk | null>;
  for (const id of Object.keys(teamColors) as TeamId[]) built[id] = clubInk(id, surface, theme);
  inkCache.set(key, built);
  return built;
};

/* ------------------------------------------------------------------ reporting */

/**
 * Everything `tools/auditClubColour.ts` prints, computed here so the audit and any UI diagnostic
 * read one implementation rather than two that can disagree.
 */
export const clubInkReport = (
  teamId: TeamId,
  surface: ClubSurface = 'panel',
  theme: ClubTheme = 'regular',
) => {
  const palette = teamColors[teamId];
  const ink = clubInk(teamId, surface, theme);
  const against = clubSurface(surface, theme);
  return {
    teamId,
    surface,
    theme,
    source: palette,
    slot: ink?.slot ?? null,
    fellBack: ink?.fellBack ?? false,
    lift: ink?.lift ?? 0,
    /** Contrast of the club's own hex, before any lift. The number that explains the design. */
    sourceContrast: contrastRatio(palette.primary, against),
    /** Contrast of what actually gets drawn. */
    inkContrast: ink ? contrastRatio(ink.hex, against) : 0,
    ink: ink?.hex ?? null,
    /** Hue angle in OKLCH degrees. Used by the check to prove a lift did not rotate the colour. */
    sourceHue: ((toOklch(palette.primary).h * 180) / Math.PI + 360) % 360,
    inkHue: ink ? (((toOklch(ink.hex).h * 180) / Math.PI + 360) % 360) : 0,
  };
};