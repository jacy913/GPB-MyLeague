import React from 'react';
import playoffDashboard from '../../assets/playoffdashboard.png';

/**
 * The playoff masthead.
 *
 * One piece of artwork filling the rectangular slot beside the headline during the postseason -- the
 * position that normally carries the power rankings and the featured game. Both are displaced for
 * measured reasons: the rankings' valuation freezes at the end of the regular season
 * (`simulationManager.ts:726` gates every increment on `isRegularSeasonGame`), and the featured game
 * is a single card where a season-defining mark has more to say.
 *
 * FULL BLEED, NOT A CARD. There is no panel border, no background and no padding here. The artwork
 * carries its own dark field, so a bordered card around it produced a smaller image inside a second
 * frame -- two edges competing, and the gold wordmark reading as a watermark on the panel rather
 * than as the panel.
 *
 * THE SOURCE IS CROPPED, NOT THE BOX. `tools/measureMastheadArt.ts` decodes the PNG and reports the
 * bounding box of everything not fully transparent: the artwork arrived as a 1200x1200 SQUARE whose
 * content is 1189x549 -- a 2.17:1 wordmark floating in a 1:1 canvas, with 31% of the height above it
 * and 23% below, both measured as literally zero opaque pixels.
 *
 * So every `object-cover` crop applied to it was cutting padding and calling it a design decision,
 * and the bottom of that symmetric crop took the sponsor line with it -- which is precisely the
 * reported symptom. Cropping the source to its content box removes the problem at the root: the
 * image is now 2.17:1, close to the ~1.7:1 slot, and there is almost nothing left to crop.
 *
 * `object-contain`, NOT `object-cover`. Once the source is 2.17:1 and the slot is ~1.7:1, cover would
 * fill the HEIGHT and crop the SIDES -- taking the first and last letters off "Playoffs" all over
 * again, on the other axis. Contain letterboxes instead: the artwork is a few dozen pixels shorter
 * than the slot and centres in it. Those bands are transparent, so they show the page behind and are
 * invisible; there is no background to mismatch and no letterbox to see.
 *
 * THE WRAPPER FILLS ITS GRID TRACK; IT DOES NOT SET ITS OWN HEIGHT. It sits in the same subgrid row
 * as the headline panel (`HomeDashboard`), so it is exactly as tall as whatever that carousel is
 * currently showing. That matters because the headline panel's height CHANGES with the slide -- a
 * longer headline wraps and grows -- and an earlier version of this sized the masthead with a fixed
 * aspect ratio, which matched the track on one day and left the Primetime Game sitting 20px out of
 * line with the newsroom on the next. The height is not ours to choose here.
 *
 * `aspect-[16/10]` REMAINS as the fallback for viewports below `xl`, where the columns are
 * independent flex stacks and no track is shared. Without it the wrapper would collapse to nothing,
 * since the only child is absolutely positioned.
 *
 * THE IMAGE IS ABSOLUTELY POSITIONED so that it fills the track without contributing height back
 * into it. A static `h-full` image would feed its own size into the track it is measured against.
 *
 * THE ARTWORK IS NOW 532KB, down from 572KB, and this is the only import of it in the codebase, so it
 * lands in the bundle once. That is a deliberate fact rather than luck: this project has shipped
 * ~22 MB of unreferenced media three times, and the guard against a fourth is that an asset has
 * exactly one importer. If it is ever also wanted on the bracket page, it must be passed or
 * re-exported from here rather than imported a second time.
 */
export const PlayoffMasthead: React.FC = () => (
  <div className="relative aspect-[16/10] w-full overflow-hidden xl:aspect-auto xl:h-full">
    <img
      src={playoffDashboard}
      alt="Playoffs, presented by MacroBet"
      className="absolute inset-0 block h-full w-full object-contain"
      loading="eager"
      decoding="async"
    />
  </div>
);