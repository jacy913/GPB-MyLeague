import { useMemo } from 'react';
import type { Game, LeaguePlayerState } from '../types';
import type { MediaId } from '../data/media';
import { MEDIA_PROFILES } from '../data/media';
import { MAX_PROPS_PER_OUTLET, buildPropMarkets, selectOutletProps } from '../lib/mediaProps';
import type { PropMarket } from '../lib/playerProps';

export interface PropBoard {
  /** Every prop on the slate, priced by all three outlets. Null if no slate. */
  all: PropMarket[];
  /** Each outlet's own picks, at most MAX_PROPS_PER_OUTLET apiece. */
  byOutlet: Map<MediaId, PropMarket[]>;
  /** Flattened, in outlet order then board order. For a single combined list. */
  everyOutlets: Array<{ market: PropMarket; mediaId: MediaId }>;
}

/**
 * The prop board, built once and shared.
 *
 * Extracted into a hook because The Media and Betting both need it and the point of the
 * betting page is that a bettor can never be shown a number that DISAGREES with one from
 * The Media. ("Disagrees", not "does not also show" -- The Media's lines table is a board
 * of crests and no longer paints outlet prices, so the stronger wording stopped being true
 * while the guarantee itself held. Both screens still call this one function on one input.)
 *
 * A single board also makes agreement mean something. Because the outlets choose from the same set of
 * markets rather than each constructing their own, a prop two outlets both picked is a prop they agree
 * on. If they built their own, the same prop appearing twice would be a coincidence instead.
 *
 * Deliberately takes the reads already computed by the caller rather than
 * rebuilding them. Both pages run buildMediaReads for their own tables, and
 * scoring the slate twice would mean the props could be tilted off a spread
 * while the moneylines beside them were tilted off another.
 */
export const usePropBoard = (input: {
  games: Game[];
  playerState: LeaguePlayerState;
  slateDate: string | null;
  teamScores: Record<MediaId, Map<string, number>>;
  scoreSpread: Record<MediaId, number>;
  /**
   * Team id to win percentage, or null where there is no record yet.
   *
   * Needed by `selectionAffinity`, which favours props on clubs an outlet's method
   * suits. It is passed in rather than derived here because the hook does not hold
   * the teams -- the callers do, and both already have them for the read tables. It
   * is also the one input to the affinity that is NOT a function of the market, so
   * leaving it out would have shipped a term that silently never fired.
   */
  teamWinPct?: (teamId: string) => number | null;
}): PropBoard => {
  const { games, playerState, slateDate, teamScores, scoreSpread, teamWinPct } = input;

  const all = useMemo(() => {
    if (!slateDate) return [];
    return buildPropMarkets({ games, playerState, slateDate, teamScores, scoreSpread });
  }, [games, playerState, slateDate, teamScores, scoreSpread]);

  const byOutlet = useMemo(() => {
    const board = new Map<MediaId, PropMarket[]>();
    for (const profile of MEDIA_PROFILES) {
      board.set(
        profile.id,
        selectOutletProps(all, profile.id, MAX_PROPS_PER_OUTLET, {
          teamWinPct: teamWinPct ?? (() => null),
        }),
      );
    }
    return board;
  }, [all, teamWinPct]);

  const everyOutlets = useMemo(
    () => MEDIA_PROFILES.flatMap((profile) => (byOutlet.get(profile.id) ?? []).map((market) => ({ market, mediaId: profile.id }))),
    [byOutlet],
  );

  return { all, byOutlet, everyOutlets };
};
