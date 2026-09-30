import type { MediaId } from '../../data/media';
import glorestMasthead from '../../assets/media/glorestpress-masthead.jpg';
import glorestMark from '../../assets/media/glorestpresslogo-trim.png';
import glorestSquare from '../../assets/media/glorestpresslogo-trim-square.png';
import hollisMasthead from '../../assets/media/quincyhollis-masthead.jpg';
import hollisMark from '../../assets/media/quincyhollislogo-trim.png';
import hollisSquare from '../../assets/media/quincyhollislogo-trim-square.png';
import sharplyMasthead from '../../assets/media/linedsharply-masthead.jpg';
import sharplyMark from '../../assets/media/linedsharplylogo-trim.png';
import sharplySquare from '../../assets/media/linedsharplylogo-trim-square.png';

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
};

/**
 * Forecaster marks.
 *
 * The supplied marks arrive as 1408x768 canvases with the artwork small and
 * centred in a large transparent margin, so used as-is the mark would fill only
 * a fraction of any box it sat in. Each is cropped to its own alpha bounding
 * box, which is what the -trim variants are. Hollis is a signature in a disc
 * and the other two are network crests, which is the intended difference
 * between a correspondent and an institution.
 */
export const MEDIA_MARKS: Record<MediaId, string> = {
  hollis: hollisMark,
  glorest: glorestMark,
  sharply: sharplyMark,
};

/**
 * Square variants of the same marks, for table headers.
 *
 * The three marks have three different natural shapes -- Hollis is a disc, the
 * other two are wide wings -- so a shared header box sized to any one of them
 * makes the others look small. Each is centred on its own bounding box and cut
 * to the largest square that fits, which gives all three the same visual weight
 * in a column header.
 */
export const MEDIA_MARKS_SQUARE: Record<MediaId, string> = {
  hollis: hollisSquare,
  glorest: glorestSquare,
  sharply: sharplySquare,
};
