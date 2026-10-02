import type { HeadlinerId } from '../../logic/headliners';

import gatzWallpaper from '../../assets/media/chrisgatzwallpaper.jpg';
import hildagoperezWallpaper from '../../assets/media/hildagoperezwallpaper.jpg';
import sooWallpaper from '../../assets/media/christinesoowallpaper.jpg';
import buccelliWallpaper from '../../assets/media/tombuccelliwallpaper.jpg';
import hoaniWallpaper from '../../assets/media/simonhoaniwallpaper.jpg';
import scintillaWallpaper from '../../assets/media/scintilla2wallpaper.jpg';

/**
 * A reporter's backdrop, in the same `{ src, alt }` shape as `MEDIA_WALLPAPERS`.
 *
 * The wallpaper plan (§4.1) proposed `wallpaper?: string` plus a separate `wallpaperAlt?: string` on
 * the profile, which makes the alt text optional in the type and therefore forgettable. Two optional
 * fields that must be supplied together is one required field. Mirroring the forecaster shape also
 * means the two registries are learnable as one, which was the point of the plan.
 */
export interface HeadlinerImage {
  src: string;
  alt: string;
}

/**
 * Every reporter has one. `Partial`, unlike the forecaster set, and the difference is deliberate:
 *
 * A reporter's wallpaper is a byline BACKDROP -- it sits behind a name and a column of text -- so a
 * reporter without one degrades to a bare byline and still reads perfectly. The forecaster card
 * carries a price, and the registry's own comment is explicit that "a wallpaper at full strength
 * behind a price is a wallpaper you cannot read a price on", which is a different and harsher
 * requirement.
 *
 * The wallpaper plan (§5.3) argued that Gatz should have none, on the grounds that a veteran traded
 * out of television having no backdrop would be "character". He has one. The four wallpapers the plan
 * listed as "needs authoring" -- Perez, Soo, Buccelli and Gatz -- were all already on disk, unreferenced.
 * So the bare-byline path is kept as a real fallback rather than as a designed moment, and nothing
 * depends on an asset that does not exist.
 */
export const HEADLINER_WALLPAPERS: Partial<Record<HeadlinerId, HeadlinerImage>> = {
  perez: {
    src: hildagoperezWallpaper,
    alt: 'The Glorest Sports field reporter, courtside',
  },
  gatz: {
    src: gatzWallpaper,
    alt: 'A veteran broadcaster in the booth, alone after the broadcast',
  },
  soo: {
    src: sooWallpaper,
    alt: 'The Calibrated Sports youth desk, late edition',
  },
  tombuccelli: {
    src: buccelliWallpaper,
    alt: 'The Booth columnist, back page',
  },
  hoani: {
    src: hoaniWallpaper,
    alt: 'The Calibrated Sports data desk, mid-correction',
  },
  /*
   * SCINTILLA IS HERE DESPITE HAVING A FORECASTER WALLPAPER ALREADY.
   *
   * `scintilla2wallpaper.jpg` is registered in `MEDIA_WALLPAPERS` for the forecaster card, and it is
   * the same artwork. He is still a `HeadlinerId` until step 5 of the restructure, so without this
   * entry his dossier fell through to the bare fallback and showed no hero at all -- which is exactly
   * what a screenshot of the modal caught.
   *
   * Both registries pointing at one file is temporary and is the same duplication the wallpaper plan
   * flags for Shinonome. Step 5 removes him from the forecaster set and this entry becomes the only
   * reference; until then it is one import, not a copy.
   */
  scintilla: {
    src: scintillaWallpaper,
    alt: 'The Scintilla channel, mid-read',
  },
  /*
   * SHINONOME IS DELIBERATELY ABSENT, and the compiler says so.
   *
   * Her wallpaper (`fuyukashinonomewallpaper.jpg`) is not imported either, so nothing here references
   * an asset this registry cannot place. Adding her key before she crosses over is a type error --
   * `shinonome` is not a `HeadlinerId` while she is still a forecaster -- and widening `HeadlinerId`
   * to make her fit would have produced a reporter id that resolves to no profile at all.
   *
   * This is the same seam Scintilla is on from the other side: his forecaster assets cannot land until
   * his profile exists, because the media image maps are keyed by `MediaId`.
   */
};

/**
 * WHY THESE ARE NOT IN THE HEADLINER PROFILE
 *
 * `gpb-wallpaper-integration.md` §4.1 puts `wallpaper` and `wallpaperAlt` directly on
 * `HeadlinerProfile`. That would make `src/logic/headliners.ts` import six JPEGs, which breaks the
 * rule that module already documents for itself and for `mediaReads.ts`: bundler asset imports do not
 * resolve under tsx, so a single image import in the data module makes the entire read module
 * untestable outside a browser. The lore and the imagery have to stay apart, exactly as they are for
 * the forecasters -- `MediaProfile` in `data/media.ts` carries no image fields either.
 *
 * So the mapping lives here, beside the forecaster's, and is looked up by id.
 */