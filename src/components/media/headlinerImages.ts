import type { HeadlinerId } from '../../logic/headliners';

import gatzWallpaper from '../../assets/media/chrisgatzwallpaper.jpg';
import hildagoperezWallpaper from '../../assets/media/hildagoperezwallpaper.jpg';
import sooWallpaper from '../../assets/media/christinesoowallpaper.jpg';
import buccelliWallpaper from '../../assets/media/tombuccelliwallpaper.jpg';
import hoaniWallpaper from '../../assets/media/simonhoaniwallpaper.jpg';
import shinonomeWallpaper from '../../assets/media/fuyukashinonomewallpaper.jpg';

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
   * SHINONOME IS HERE NOW, and this is the last of the six.
   *
   * The same file is still registered in `MEDIA_WALLPAPERS`, because the forecaster-side removal that
   * would retire it is deliberately the SECOND half of her move. She has to stop being a forecaster
   * before her card can leave the forecaster set, and that is a separate change with a separate
   * reviewable diff. One import, two references, no copy of the asset -- and once the forecaster entry
   * goes this becomes the only one.
   */
  shinonome: {
    src: shinonomeWallpaper,
    alt: 'Fuyuka TV, third row, on a summer night',
  },
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
