/**
 * The 32 clubs' official colours: primary, secondary, tertiary.
 *
 * Authored by hand, deliberately one entry per club and one line per club, so a colour can be
 * corrected without touching anything else. `tools/checkClubInk.ts` gates this file; nothing in
 * the build reads it directly, because every render path goes through `clubInk` in
 * `src/lib/clubColour.ts` instead of using these hexes as-is.
 *
 * WHY THE RAW HEXES ARE NOT WHAT GETS DRAWN. Every surface in this app is a dark navy
 * (`--color-panel` #161d2e, luma 29) and these are real uniforms: primary luma runs from 27
 * (`urb`) to 255 (`loy`). Measured against the panel, three clubs' primary is below 1.2:1 and
 * would be invisible as a rule -- `ock` 1.04, `urb` 1.03, `dwi` 1.14 -- while eighteen others
 * read at over 3:1. So the hex is the *identity*, not the *renderable value*. `clubInk` lifts a
 * colour into the legible band while holding its hue, which is what lets all 32 clubs get the
 * same treatment instead of the ones that happened to be light getting the good version.
 *
 * This is why editing a hex here needs no regeneration step: the derivation runs at render time.
 *
 * MOVED from `src/assets/teamcolors.ts`. That folder is for Vite-emitted asset URLs;
 * `parks.json` and `popularity.json` are the precedent for authored data.
 */

/**
 * The club ids, as a union rather than `string`.
 *
 * A `Record<string, ...>` lets `teamColors.dwi2` compile clean and evaluate to `undefined`, which
 * is a typo that surfaces as a missing colour at runtime with nothing to catch it -- the same hole
 * the missing `@types/react` opened in this project. Keying by the union makes that a type error.
 * `tools/checkClubInk.ts` asserts this union is exactly the set of clubs in `INITIAL_TEAMS`, so
 * adding a club without a colour, or a colour without a club, is a failing check rather than an
 * invisible gap.
 */
export type TeamId =
  | 'alc' | 'val' | 'luf' | 'hui'
  | 'ara' | 'des' | 'suk' | 'gar'
  | 'gra' | 'tru' | 'caf' | 'rag'
  | 'win' | 'aub' | 'dwi' | 'hou'
  | 'ock' | 'bal' | 'fes' | 'urb'
  | 'sin' | 'loy' | 'niy' | 'ars'
  | 'der' | 'rei' | 'fey' | 'cal'
  | 'sta' | 'bra' | 'geb' | 'and';

export interface ClubPalette {
  /** The club's main colour. Identity only -- see the header before drawing it. */
  primary: string;
  /** Second choice, used by `clubInk` when the primary cannot be lifted legibly. */
  secondary: string;
  /** Third choice, and the wash colour. Usually very dark or very light -- see `clubInk`. */
  tertiary: string;
}

/**
 * Ordering matters and is the canonical one from `INITIAL_TEAMS`: Platinum then Prestige, each
 * North / South / West / East. `checkClubInk` asserts the key order matches, so this file reads
 * in the same order as `teams.ts` rather than being an alphabet to be decoded.
 */
export const teamColors: Record<TeamId, ClubPalette> = {
  // Platinum League — North
  alc: { primary: '#511454', secondary: '#636362', tertiary: '#151515' }, // Alcondale Aerials
  val: { primary: '#7a3748', secondary: '#d3d0d2', tertiary: '#060606' }, // Vallile Crimsons
  luf: { primary: '#ec6d22', secondary: '#102f6b', tertiary: '#fffffd' }, // Luffenkreg Shields
  hui: { primary: '#f7c417', secondary: '#2e1c46', tertiary: '#fdfefd' }, // Huidor Shepherds

  // Platinum League — South
  ara: { primary: '#36656b', secondary: '#19253d', tertiary: '#afabaa' }, // Arabay Marines
  des: { primary: '#db242b', secondary: '#db242b', tertiary: '#000000' }, // Desseldein Muskets
  suk: { primary: '#d52f27', secondary: '#ffffff', tertiary: '#120b0b' }, // Sukensi Prawns
  gar: { primary: '#ceccce', secondary: '#6cc498', tertiary: '#0f1a20' }, // Garsollo Mustangs

  // Platinum League — West
  gra: { primary: '#183ea1', secondary: '#898c8c', tertiary: '#898c8c' }, // Grandland Cobalts
  tru: { primary: '#163250', secondary: '#ce652b', tertiary: '#fbfcfd' }, // Trusceland Apes
  caf: { primary: '#fbfcfd', secondary: '#000000', tertiary: '#ffffff' }, // Calfein Phantoms
  rag: { primary: '#4e2e5d', secondary: '#100f1d', tertiary: '#feffff' }, // Ragnahas Crows

  // Platinum League — East
  win: { primary: '#3d6a4c', secondary: '#eeeeee', tertiary: '#1d1d1d' }, // Wingten Generals
  aub: { primary: '#6cb3d6', secondary: '#b1b2b2', tertiary: '#dbe1e5' }, // Aubagne Vipers
  dwi: { primary: '#172843', secondary: '#d61821', tertiary: '#521121' }, // Dwifdern Hooves
  hou: { primary: '#782020', secondary: '#e36c32', tertiary: '#0f0f11' }, // Houssen Brazens

  // Prestige League — North
  ock: { primary: '#061a33', secondary: '#d2d2d2', tertiary: '#feffff' }, // Ockshein Nighthawks
  bal: { primary: '#f47006', secondary: '#010101', tertiary: '#555555' }, // Baltdorsch Engineers
  fes: { primary: '#cc9f63', secondary: '#533422', tertiary: '#000000' }, // Festor Leopards
  urb: { primary: '#1b1b1a', secondary: '#1b1b1a', tertiary: '#696869' }, // Urbington Lads

  // Prestige League — South
  sin: { primary: '#0cb3a9', secondary: '#efd23f', tertiary: '#fefefe' }, // Sinope Seals
  loy: { primary: '#ffffff', secondary: '#ffffff', tertiary: '#424242' }, // Loyaton Blacksails
  niy: { primary: '#9cd1d4', secondary: '#134b5b', tertiary: '#ffffff' }, // Niyoli Reefs
  ars: { primary: '#fb096b', secondary: '#ffffff', tertiary: '#2d0325' }, // Arsagam Dunes

  // Prestige League — West
  der: { primary: '#fcda01', secondary: '#997826', tertiary: '#161005' }, // Derackdran Electrics
  rei: { primary: '#00407e', secondary: '#a40c24', tertiary: '#4c4d4a' }, // Reinland Rogues
  fey: { primary: '#727272', secondary: '#09090b', tertiary: '#f5f5f5' }, // Feyford Diesels
  cal: { primary: '#7b7e4a', secondary: '#ca9937', tertiary: '#11120d' }, // Calukan Agents

  // Prestige League — East
  sta: { primary: '#a30c24', secondary: '#c2c3c4', tertiary: '#670220' }, // Stantral Demons
  bra: { primary: '#dd2e31', secondary: '#010001', tertiary: '#f8f8f8' }, // Brasshoem Stripes
  geb: { primary: '#780c23', secondary: '#f3b945', tertiary: '#3d0412' }, // Gebrook Griffins
  and: { primary: '#f7c611', secondary: '#64b8e3', tertiary: '#002854' }, // Andrard Smokies
};

/** The order the fallback chain tries, in order. */
export const PALETTE_SLOTS = ['primary', 'secondary', 'tertiary'] as const;
export type PaletteSlot = (typeof PALETTE_SLOTS)[number];