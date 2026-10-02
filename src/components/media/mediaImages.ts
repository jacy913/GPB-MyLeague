import type { MediaId } from '../../data/media';
import glorestMasthead from '../../assets/media/glorestpress-masthead.jpg';
import glorestMark from '../../assets/media/glorestpresslogo-trim.png';
import glorestSquare from '../../assets/media/glorestpresslogo-trim-square.png';
import glorestPortrait from '../../assets/media/glorest-portrait.png';
import hollisMasthead from '../../assets/media/quincyhollis-masthead.jpg';
import hollisMark from '../../assets/media/quincyhollislogo-trim.png';
import hollisSquare from '../../assets/media/quincyhollislogo-trim-square.png';
import hollisPortrait from '../../assets/media/hollis-portrait.png';
import sallowMark from '../../assets/media/sallow-trim-square.webp';
import sallowPortrait from '../../assets/media/sallow-portrait.png';
import jardinsMark from '../../assets/media/jardins-trim-square.webp';
import jardinsPortrait from '../../assets/media/jardins-portrait.png';
import boyleMark from '../../assets/media/boyle-trim-square.webp';
import boylePortrait from '../../assets/media/boyle-portrait.png';
import mussadMark from '../../assets/media/mussad-trim-square.webp';
import mussadPortrait from '../../assets/media/mussad-portrait.png';
import wardleyMark from '../../assets/media/wardley-trim-square.webp';
import wardleyPortrait from '../../assets/media/wardley-portrait.png';
import sallowWallpaper from '../../assets/media/garysallowwallpaper.png';
import shinonomeMark from '../../assets/media/shinonome-trim-square.webp';
import shinonomePortrait from '../../assets/media/shinonome-portrait.png';
import jardinsWallpaper from '../../assets/media/audreyjardinswallpaper.png';
import fuyukaWallpaper from '../../assets/media/fuyukashinonomewallpaper.jpg';
import glorestWallpaper from '../../assets/media/glorestsportswallpaper.jpg';
import boyleWallpaper from '../../assets/media/landonboylewallpaper.jpg';
import mussadWallpaper from '../../assets/media/tariqmussadwallpaper.jpg';
import wardleyWallpaper from '../../assets/media/vancewardleyjrwallpaper.jpg';
import sharplyMasthead from '../../assets/media/linedsharply-masthead.jpg';
import sharplyMark from '../../assets/media/linedsharplylogo-trim.png';
import sharplySquare from '../../assets/media/linedsharplylogo-trim-square.png';
import sharplyPortrait from '../../assets/media/sharply-portrait.png';

/**
 * Forecaster photography, kept apart from the character data on purpose.
 *
 * data/media.ts is imported by lib/mediaReads.ts, which is headless and runs
 * under tsx in the diagnostic tools. Bundler asset imports do not resolve there,
 * so a single .jpg import in the character data would make the entire read
 * module untestable outside a browser. The imagery is presentation and belongs
 * with the presentation.
 *
 * Each file is a crop of the supplied photograph, resized to a 1200px long edge
 * at JPEG quality 80. The originals were 4.8MB between them, which is not
 * something to ship for a decoration. The Hollis crop is cut above the press
 * credential in the source image, which names a different character.
 */
export interface MediaImage {
  src: string;
  alt: string;
}

export const MEDIA_IMAGES: Record<MediaId, MediaImage> = {
  hollis: {
    src: hollisMasthead,
    alt: 'Quincy Hollis reporting from the GPB press box',
  },
  glorest: {
    src: glorestMasthead,
    alt: 'The Glorest Press broadcast wall in the city',
  },
  sharply: {
    src: sharplyMasthead,
    alt: 'The Lined Sharply podcast studio',
  },
  /*
   * THE FIVE NEW OUTLETS POINT AT THEIR OWN HERO PORTRAIT, not a masthead.
   *
   * No masthead exists for them -- a masthead is a photograph of a set, and these five were
   * supplied as portraits of people. Rather than leave five broken images or invent five sets,
   * the map uses the portrait they do have. MediaCard crops it square, so it reads correctly
   * in the collapsed card; only the alt text says plainly which it is.
   */
  sallow: { src: sallowPortrait, alt: 'Gary Sallow, The Booth' },
  jardins: { src: jardinsPortrait, alt: 'Audrey Jardins, The Booth' },
  boyle: { src: boylePortrait, alt: 'Landon Boyle, Calibrated Sports' },
  mussad: { src: mussadPortrait, alt: 'Tariq Mussad, Calibrated Sports' },
  wardley: { src: wardleyPortrait, alt: 'Vance Wardley Jr, Glorest Sports' },
  shinonome: { src: shinonomePortrait, alt: 'Fuyuka Shinonome of Fuyuka TV' },
};

/**
 * Forecaster portraits, for the character popup.
 *
 * These are the three supplied 2048x2048 RGBA cut-outs, re-framed and reduced by
 * `tools/buildMediaPortraits.ts`. The sources weighed 13.1MB between them; these weigh 1.6MB,
 * a saving the tool reports rather than one asserted here.
 *
 * 4:5 rather than square, because a square crop of a person is a passport photograph. The frame
 * is anchored to the alpha bounds of the rows ABOVE the vertical midpoint, not to the whole
 * silhouette -- Hollis's arms and elbow make his full outline far wider than his head, so a
 * frame centred on the whole subject would leave a third of the picture empty beside his face.
 *
 * THE THREE ARE DELIBERATELY NOT THE SAME PICTURE, and the tool reports why per outlet:
 *
 *   hollis   a loose figure, set right of centre -> framed head and shoulders
 *   glorest  already a tight head-and-shoulders  -> framed the same way, lands the same
 *   sharply  TWO hosts, both logos visible       -> whole canvas kept
 *
 * That last one is the reason the crop rule has a fallback rather than being a single formula.
 * Sharply is a podcast with two presenters and an embroidered logo on each of them; cropping to
 * one face would delete half the outlet. So the rule yields to the picture and says so.
 *
 * TRANSPARENT, NOT WHITE. The sources are genuine alpha cut-outs, so these sit directly on the
 * popup's own surface with no plate behind them. That is why the popup does not put a white or
 * photographic background behind the portrait -- doing so would put a visible rectangle around
 * a subject who has no rectangular edge.
 */
export const MEDIA_PORTRAITS: Record<MediaId, MediaImage> = {
  hollis: {
    src: hollisPortrait,
    alt: 'Quincy Hollis at the press box, adjusting his collar before the game',
  },
  /*
    * ALT TEXT DESCRIBES THE PICTURE, NOT THE PERSON.
    *
    * The first draft of this said "Vance Wardley Jr", which I took from the character data
    * rather than from the photograph -- and there is no way to confirm from here that the man
    * in the file is the man in the data. An alt attribute is read aloud to a screen-reader user
    * who cannot see the image and has no other way to check it, so a name asserted there is a
    * claim the interface cannot stand behind. The outlet's mark on the shirt is what is
    * actually visible.
    */
  glorest: {
    src: glorestPortrait,
    alt: 'A Glorest presenter, arms folded, the network mark showing on his shirt',
  },
  sharply: {
    src: sharplyPortrait,
    alt: 'The two Lined Sharply hosts in the studio, each wearing the embroidered show mark',
  },
  sallow: { src: sallowPortrait, alt: 'Gary Sallow at The Booth' },
  jardins: { src: jardinsPortrait, alt: 'Audrey Jardins of The Booth' },
  boyle: { src: boylePortrait, alt: 'Landon Boyle, who covers one division closely' },
  mussad: { src: mussadPortrait, alt: 'Tariq Mussad, who covers the league rather than the clubs' },
  wardley: { src: wardleyPortrait, alt: 'Vance Wardley Jr, who reads farm systems' },
  shinonome: { src: shinonomePortrait, alt: 'Fuyuka Shinonome, who writes about the club she loves' },
};

/**
 * Forecaster marks.
 *
 * The supplied marks arrive with the artwork small and centred in a large transparent
 * margin, so used as-is a mark would fill only a fraction of any box it sat in. Each is
 * cropped to its own alpha bounding box and given 8px of transparent padding on every side;
 * those -trim variants are what this map uses. Hollis is a signature in a disc and the other
 * two are network crests, which is the intended difference between a correspondent and an
 * institution.
 *
 * THE PADDING AND THE RULE BEHIND IT ARE MEASURED, NOT ASSUMED, and the code that produces
 * these files is `tools/buildMediaMarks.ts`. The details worth knowing before changing
 * anything here:
 *
 *   - The supplied canvases are not all the same size. Hollis and Sharply arrived at
 *     1408x768; the current Glorest mark arrived at 1024x1024. Nothing downstream may assume
 *     a canvas dimension.
 *
 *   - The trim is the alpha bounding box PLUS 8px of padding, which is 16px larger in each
 *     axis than the bare box. Confirmed against all three committed marks. Without the padding
 *     the outermost pixel of a logo touches the edge of its own box, which reads as a seam
 *     against any background and makes three marks in a row look like three sizes.
 *
 *   - Rebuilding the existing marks from their own sources reproduces the committed trim at
 *     0.12/255 mean channel difference with zero silhouette mismatches, and the committed
 *     square at 2.27/255 -- the residual being the original tool's downsampling filter rather
 *     than any geometry difference. So the rule in `buildMediaMarks` is the rule that made
 *     these files, and it self-checks against them before it will overwrite them.
 *
 * The alpha bounding box uses a floor of 8 rather than "any non-transparent pixel", because
 * an alpha of 1 is invisible and anti-aliased edges routinely carry a few of them.
 */
export const MEDIA_MARKS: Record<MediaId, string> = {
  hollis: hollisMark,
  glorest: glorestMark,
  sharply: sharplyMark,
  /*
   * THE FIVE POINT AT THEIR SQUARE MARK, and that is a substitution worth naming.
   *
   * The first three have a real trim because they are CRESTS -- wide artwork with a shape that
   * is not square, and letterboxing a crest looks wrong. The five new ones are photographs of
   * people, and a square crop of a face letterboxes correctly because the composition is
   * already centred.
   *
   * So they share one file per outlet across both maps rather than carrying two near-identical
   * WebPs. The alternative -- a separate 4:5 trim each -- would add five files to save nothing,
   * since the square is what every call site renders at anyway (h-8 to h-10, i.e. 32-40px).
   */
  sallow: sallowMark,
  jardins: jardinsMark,
  boyle: boyleMark,
  mussad: mussadMark,
  wardley: wardleyMark,
  shinonome: shinonomeMark,
};

/**
 * Square variants of the same marks, for table headers.
 *
 * The three marks have three different natural shapes -- Hollis is a disc, the other two are
 * wide wings -- so a shared header box sized to any one of them makes the others look small.
 * Each is centred on a TRANSPARENT square canvas whose side is its longest edge and then
 * resized to 96x96, which gives all three the same visual weight in a column header.
 *
 * It PADS rather than crops, and that distinction is not cosmetic: cutting the largest square
 * that fits as a WINDOW through the artwork removes the outer wings entirely and produced a
 * file sharing almost nothing with the committed square. The whole mark is scaled to sit
 * inside the square, with transparent bands on the short axis.
 *
 * Minification uses an area-average filter rather than nearest-neighbour. Reducing a ~1000px
 * mark to 96px with nearest samples roughly one pixel in eleven and throws away the other ten,
 * which on a hard-edged crest stair-steps every diagonal -- and this logo is nothing but
 * diagonals.
 */
export const MEDIA_MARKS_SQUARE: Record<MediaId, string> = {
  hollis: hollisSquare,
  glorest: glorestSquare,
  sharply: sharplySquare,
  sallow: sallowMark,
  jardins: jardinsMark,
  boyle: boyleMark,
  mussad: mussadMark,
  wardley: wardleyMark,
  shinonome: shinonomeMark,
};

/**
 * OUTLET WALLPAPERS.
 *
 * Seven of the nine outlets have one. Sharply and Hollis have none supplied, which is worth saying
 * plainly rather than leaving as a gap that reads as deliberate.
 *
 * Sallow's arrived after the first pass and is now wired, so he is no longer the third exception
 * the earlier version of this comment described.
 * It is OPTIONAL per outlet rather than a `Record<MediaId, ...>`, deliberately. A required entry
 * would have forced a placeholder for the three that have nothing, and a placeholder wallpaper is
 * worse than no wallpaper -- it looks like art rather than like a missing file.
 *
 * Intended as a low-contrast backdrop behind the outlet's own surface, not as a photograph to
 * look at. A wallpaper at full strength behind a price is a wallpaper you cannot read a price on.
 */
export const MEDIA_WALLPAPERS: Partial<Record<MediaId, MediaImage>> = {
  sallow: { src: sallowWallpaper, alt: 'The Booth, mid-session' },
  glorest: { src: glorestWallpaper, alt: 'The Glorest Sports broadcast backdrop' },
  jardins: { src: jardinsWallpaper, alt: 'The Booth, set on the road' },
  boyle: { src: boyleWallpaper, alt: 'Calibrated Sports, from the third-base camera well' },
  mussad: { src: mussadWallpaper, alt: 'The Calibrated Sports desk' },
  wardley: { src: wardleyWallpaper, alt: 'A clubhouse wall at the Glorest Sports outlet' },
  shinonome: { src: fuyukaWallpaper, alt: 'Fuyuka TV, third row, on a summer night' },
};
