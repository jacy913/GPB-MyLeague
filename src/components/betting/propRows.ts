import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES, MEDIA_BY_ID } from '../../data/media';
import type { PropMarket } from '../../lib/playerProps';

/**
 * One row per unique prop, with every outlet's opinion attached.
 *
 * ============================================================================
 * WHY THE PROPS BOARD IS NOT A GRID OF OUTLET PANELS
 * ============================================================================
 *
 * The board was nine side-by-side panels, one per outlet, each holding that outlet's fifteen
 * props. That shape is defensible for exactly three outlets and falls apart at nine, for one
 * structural reason:
 *
 * `selectOutletProps` runs PER OUTLET over a SHARED market pool. So outlets overlap. When
 * Hollis and Sharply both like `Alvarez Over 2.5 hits`, that prop was rendered TWICE -- once in
 * Hollis's column, once in Sharply's -- each with its own card, its own buttons and its own read.
 * The tab read "Props (135)" for what is materially fewer than 135 distinct markets.
 *
 * So the congestion was never really "nine outlets is too many opinions". It was that ONE market
 * was being drawn N times because each outlet needed its own price on it. Those are different
 * problems and they have different fixes.
 *
 * The fix is to render the MARKET once and carry the outlet opinions as data on it. One card per
 * unique propId, a compact strip showing which outlets published it, and a disclosure for the
 * individual reads. Height collapses from "every opinion gets a card" to "every market gets a
 * card", and the width problem goes with it because one column is comfortably wide.
 *
 * ============================================================================
 * NOTHING IS LOST
 * ============================================================================
 *
 * Every outlet that published a prop is still recorded, still priced, and still reachable. The
 * house line is unchanged -- it is built from `consensusProbability`, which is computed over the
 * full pool in `playerProps.ts` and never depended on this component. What changes is only
 * presentation: opinions move out of the card's face and behind a disclosure.
 *
 * ============================================================================
 * ONE REPRESENTATIVE MARKET PER PROP
 * ============================================================================
 *
 * A `propId` is `${gameId}:${playerId}:${stat}:${line}`, so outlets publishing the same prop carry
 * the same id and therefore the same `probability`, `consensusProbability`, `spread` and
 * `outlier`. The row uses the first market it sees for the shared fields and keeps the per-outlet
 * probabilities from every one, so "representative" costs nothing and cannot drift between cards.
 */

/** One outlet's published opinion on a prop. */
export interface PropOutletRead {
  mediaId: MediaId;
  /** That outlet's own probability that the prop lands OVER. */
  probability: number;
  /** Side this outlet's read favours. */
  side: 'over' | 'under';
  /** True when this read is far enough from the pack to be tradeable. */
  canFade: boolean;
  /** True for the outlet furthest from the house line. Drives the highlight in the disclosure. */
  isOutlier: boolean;
  /** Absolute gap from the house line, in points. */
  gapFromHouse: number;
}

/** One prop card. */
export interface PropRowModel {
  propId: string;
  /** Shared fields, taken from the first market carrying this propId. */
  market: PropMarket;
  /** Every outlet that published it, in registry order. */
  reads: PropOutletRead[];
  /** Outlets furthest from the house line. Ties are possible once the pool passed three. */
  outliers: MediaId[];
  /** How many outlets published this prop. */
  publishedBy: number;
}

/**
 * The spread at which an outlet's own read is far enough from the pack to be a decision rather
 * than a vote.
 *
 * Six points, not two. The threshold widened when the pool grew from three outlets to nine,
 * because the same absolute gap means less when there are more opinions to spread across; at two
 * points with nine publishers almost every card would offer a fade and the button would stop
 * meaning anything.
 */
export const PROP_FADE_THRESHOLD = 0.06;

const sideFor = (probability: number): 'over' | 'under' => (probability >= 0.5 ? 'over' : 'under');

/**
 * Collapse per-outlet boards into one model per unique prop.
 *
 * `boards` is the same `Map<MediaId, PropMarket[]>` the props tab already receives, so this is a
 * pure reorganisation of data already in memory -- no new fetch, no second source that could
 * disagree with the first.
 *
 * Registry order rather than outlet-supplied order, so a prop's publisher list is stable between
 * renders. Sorting by how far each outlet sits from the house line happens in the component,
 * because that is a presentation choice and this function stays about data.
 */
export const buildPropRows = (boards: Map<MediaId, PropMarket[]>): PropRowModel[] => {
  const byPropId = new Map<string, PropRowModel>();

  MEDIA_PROFILES.forEach((profile) => {
    for (const market of boards.get(profile.id) ?? []) {
      const existing = byPropId.get(market.propId);

      if (!existing) {
        const probability = market.probability[profile.id] ?? 0.5;
        byPropId.set(market.propId, {
          propId: market.propId,
          market,
          publishedBy: 1,
          outliers: [],
          reads: [{
            mediaId: profile.id,
            probability,
            side: sideFor(probability),
            canFade: market.spread >= PROP_FADE_THRESHOLD,
            isOutlier: market.outlier === profile.id,
            gapFromHouse: Math.abs(probability - market.consensusProbability),
          }],
        });
        continue;
      }

      /*
        * A prop published by more than one outlet.
        *
        * The shared fields are NOT re-read from this market. `propId` encodes the game, player,
        * stat and line, so every outlet's copy carries an identical consensus, spread and outlier;
        * taking them from whichever copy arrived first keeps one source of truth for the card and
        * makes it impossible for two copies of the same prop to disagree about their own shared
        * fields.
        */
      const probability = market.probability[profile.id] ?? 0.5;
      existing.reads.push({
        mediaId: profile.id,
        probability,
        side: sideFor(probability),
        canFade: market.spread >= PROP_FADE_THRESHOLD,
        isOutlier: market.outlier === profile.id,
        gapFromHouse: Math.abs(probability - existing.market.consensusProbability),
      });
      existing.publishedBy += 1;
    }
  });

  return [...byPropId.values()];
};

/** The outlets furthest from the house line, for the disclosure's highlight. */
export const outliersFor = (row: PropRowModel): MediaId[] =>
  row.reads.filter((read) => read.isOutlier).map((read) => read.mediaId);

/** Reads sorted widest-gap-first. The disclosure leads with the tradeable opinion. */
export const readsByGap = (row: PropRowModel): PropOutletRead[] =>
  [...row.reads].sort((left, right) => right.gapFromHouse - left.gapFromHouse);

/**
 * The label a disclosure row shows for one forecaster.
 *
 * The PERSON, not the masthead. Three of the nine publish as "The Booth" and two more pairs share
 * an outlet, so this used to render three identical words beside three different probabilities --
 * the exact ambiguity the disclosure exists to remove. See `foreasterName` in `data/media.ts`.
 */
export const forecasterLabel = (mediaId: MediaId): string => MEDIA_BY_ID[mediaId].name;