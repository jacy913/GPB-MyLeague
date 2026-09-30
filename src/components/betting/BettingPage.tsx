import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Game, SeasonHistoryEntry } from '../../types';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID } from '../../data/media';
import { buildMediaReads, type MediaReadInput } from '../../lib/mediaReads';
import { buildGameLine, getNextSlateDate, type GameLine } from '../../lib/mediaOdds';
import {
  buildTotalMarkets, buildDivisionMarkets, buildLeagueMarkets, buildAwardMarket,
} from '../../lib/mediaMarkets';
import type { FieldMarket } from '../../lib/markets';
import { getTeamRosterStrength } from '../../logic/teamStrength';
import { buildAwardsForBoard, type AwardEntry } from '../../lib/awardRace';
import type { PlacedBet, BetKind, Selection, Wallet } from '../../lib/wallet';
import { placeBet, settleWallet, summariseWallet, loadWallet, saveWallet, MIN_STAKE } from '../../lib/wallet';
import { BettingHub, BetSlip, BettingRecord, type WalletSummary } from './BettingHub';
import { resolveSeasonYear } from '../../lib/seasonYear';

interface BettingPageProps extends MediaReadInput {
  games: Game[];
  currentDate: string;
  wallet: Wallet;
  onWallet: (wallet: Wallet) => void;
  seasonHistory: SeasonHistoryEntry[];
}

/**
 * Betting.
 *
 * This is where the three outlets' numbers become stakes. It reads exactly the
 * same read module The Media page reads, and the same three forecasters post
 * every price here, so a bettor can never be shown a number the media page does
 * not also show. The split is intentional: The Media is their opinion, this is
 * your stake against it.
 *
 * Settlement is the other half. Bets are recorded when they are taken and are
 * only ever decided against games that completed after that, so this cannot be
 * peeked at. Games settle from the final score, first-five from the line score
 * the engine already persisted, and season markets from archived history.
 */
const BettingPage: React.FC<BettingPageProps> = ({
  games, currentDate, wallet, onWallet, seasonHistory, ...input
}) => {
  const [view, setView] = useState<'slate' | 'futures' | 'awards'>('slate');
  const [slip, setSlip] = useState<{
    kind: BetKind; marketKey: string; marketTitle: string;
    selection: Selection; selectionLabel: string; price: number; line?: number;
    backedMedia: MediaId | null;
  } | null>(null);
  const [stake, setStake] = useState(50);
  const [notice, setNotice] = useState<string | null>(null);

  const readInput = input as MediaReadInput;
  const { scores, spread } = useMemo(() => buildMediaReads(readInput), [readInput]);
  const seasonYear = useMemo(
    () => resolveSeasonYear(currentDate, games),
    [currentDate, games],
  );

  const slateDate = useMemo(() => getNextSlateDate(games, currentDate), [currentDate, games]);
  const teamById = useMemo(() => new Map(input.teams.map((t) => [t.id, t])), [input.teams]);

  /* ---------------- slate: moneyline and run totals ---------------- */

  const moneyline = useMemo<GameLine[]>(() => {
    if (!slateDate) return [];
    return games
      .filter((game) => game.date === slateDate)
      .map((game) => {
        const away = teamById.get(game.awayTeam);
        const home = teamById.get(game.homeTeam);
        if (!away || !home) return null;
        const scoreFor = (teamId: string) => ({
          hollis: scores.hollis.get(teamId) ?? 0.5,
          glorest: scores.glorest.get(teamId) ?? 0.5,
          sharply: scores.sharply.get(teamId) ?? 0.5,
        });
        return buildGameLine({
          game, away, home,
          awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread,
        });
      })
      .filter((line): line is GameLine => line !== null)
      .sort((a, b) => a.awayTeam.city.localeCompare(b.awayTeam.city));
  }, [games, scores, slateDate, spread, teamById]);

  const lines = useMemo(() => {
    if (!slateDate) return [];
    // The latent factors are z-scored against the league, so the spread has to be
    // measured rather than assumed. Passing a mean of zero and a spread of one
    // would silently turn a z-score into a raw roster rating, which is a
    // different and much larger number.
    const strength = getTeamRosterStrength(input.teams, input.playerState, seasonYear);
    const values = [...strength.values()];
    const strengthMean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const strengthSd = Math.sqrt(
      values.reduce((sum, value) => sum + (value - strengthMean) ** 2, 0) / Math.max(1, values.length),
    );

    return buildTotalMarkets(
      games.filter((game) => game.date === slateDate && game.status !== 'completed'),
      {
        teams: input.teams,
        strength, strengthMean, strengthSd,
        hasSeasonOutput: input.teams.some((team) => team.wins + team.losses > 0),
      },
      teamById,
    );
  }, [games, input.playerState, input.teams, seasonYear, slateDate, teamById]);

  /* ---------------- futures: division, league, awards ---------------- */

  const indexBy = useMemo(() => {
    const out = { hollis: scores.hollis, glorest: scores.glorest, sharply: scores.sharply } as Record<MediaId, Map<string, number>>;
    return out;
  }, [scores]);

  const futures = useMemo<FieldMarket[]>(() => [
    ...buildLeagueMarkets({ teams: input.teams, indexBy }),
    ...buildDivisionMarkets({ teams: input.teams, indexBy }),
  ], [indexBy, input.teams]);

  const awards = useMemo<FieldMarket[]>(() => {
    // The award race reads raw player maps, not a PlayerState bundle, so the
    // inputs are unpacked here rather than passed through.
    const awardInputs = {
      players: input.playerState.players,
      teamsById: teamById,
      battingStats: input.playerState.battingStats,
      pitchingStats: input.playerState.pitchingStats,
      battingRatings: input.playerState.battingRatings,
      pitchingRatings: input.playerState.pitchingRatings,
    };
    const built: Array<[string, string, AwardEntry[]]> = [
      ['batting_mvp', 'Batting MVP', buildAwardsForBoard('batting', awardInputs, 8)],
      ['pitching_mvp', 'Pitching MVP', buildAwardsForBoard('pitching', awardInputs, 8)],
    ];
    return built
      .filter(([, , entries]) => entries.length > 0)
      .map(([key, title, entries]) => buildAwardMarket(key, title, entries));
  }, [input.playerState, teamById]);

  /* ---------------- settlement ---------------- */

  /**
   * Settle on every render that has new results.
   *
   * Deliberately derived rather than fired from an effect on one specific game
   * completing: a game can be played by a bulk "sim to end of month" run that
   * settles forty games at once, and an effect keyed to a single game would miss
   * every one of them.
   */
  const settled = useMemo(() => {
    if (wallet.bets.every((bet) => bet.status !== 'open')) return wallet;
    const latest = seasonHistory[seasonHistory.length - 1];
    return settleWallet(wallet, {
      games,
      teams: input.teams,
      currentDate,
      seasonComplete: Boolean(latest),
      seasonWinners: latest
        ? {
          seasonYear: latest.seasonYear,
          divisions: new Map(latest.divisionWinners.map((w) => [`${w.league} ${w.division}`, w.teamId])),
          leagues: new Map(latest.divisionWinners.map((w) => [w.league, w.teamId])),
        }
        : null,
      awardWinners: latest
        ? new Map<string, string>([
          ['batting_mvp', latest.battingMvp?.playerId],
          ['pitching_mvp', latest.pitchingMvp?.playerId],
        ].filter((pair): pair is [string, string] => Boolean(pair[1])))
        : null,
    });
  }, [currentDate, games, input.teams, seasonHistory, wallet]);

  if (settled !== wallet) onWallet(settled);

  /* ---------------- actions ---------------- */

  const addToSlip = useCallback((entry: NonNullable<typeof slip>) => {
    setSlip(entry);
    setNotice(null);
  }, []);

  const confirm = useCallback(() => {
    if (!slip) return;
    if (stake < MIN_STAKE) {
      setNotice(`Minimum stake is ${MIN_STAKE}.`);
      return;
    }
    const result = placeBet(wallet, {
      kind: slip.kind,
      marketKey: slip.marketKey,
      marketTitle: slip.marketTitle,
      selection: slip.selection,
      selectionLabel: slip.selectionLabel,
      stake,
      price: slip.price,
      placedOn: currentDate,
      backedMedia: slip.backedMedia,
      // The run total needs its line carried on the bet, because the only way to
      // settle it later is to compare the final score against the number that
      // was actually posted, not against a line recomputed after the fact.
      note: slip.line === undefined ? undefined : String(slip.line),
    });
    if ('error' in result) {
      setNotice(result.error);
      return;
    }
    setSlip(null);
    setNotice(`Staked ${stake} on ${slip.selectionLabel}.`);
  }, [currentDate, slip, stake, wallet]);

  const summary = summariseWallet(settled);

  return (
    <section className="space-y-5">
      <BettingHub
        view={view}
        onView={setView}
        lines={lines}
        moneyline={moneyline}
        futures={futures}
        awards={awards}
        slateDate={slateDate}
        bets={settled.bets}
        balance={settled.balance}
        onPlace={addToSlip}
      />

      <BetSlip
        entry={slip}
        stake={stake}
        onStake={setStake}
        onConfirm={confirm}
        onClear={() => { setSlip(null); setNotice(null); }}
        notice={notice}
        summary={summary}
        backedBy={slip?.backedMedia ? MEDIA_BY_ID[slip.backedMedia].outlet : null}
      />

      <BettingRecord bets={settled.bets} balance={settled.balance} summary={summary} />
    </section>
  );
};

/* ------------------------------------------------------------------ *
 * Persistence wrapper
 * ------------------------------------------------------------------ */

type WalletProps = Pick<BettingPageProps, 'wallet' | 'onWallet'>;

/**
 * Holds the wallet and writes it back to storage.
 *
 * A thin wrapper rather than useState inside the page, because the page already
 * has a lot of derivation in it and the storage lifetime is a separate concern:
 * the wallet must survive the page unmounting when the manager navigates away,
 * which a local useState would not.
 */
const PersistentBettingPage: React.FC<Omit<BettingPageProps, 'wallet' | 'onWallet'>> = (props) => {
  const [wallet, setWallet] = useState<Wallet>(loadWallet);

  useEffect(() => {
    saveWallet(wallet);
  }, [wallet]);

  return <BettingPage {...props} wallet={wallet} onWallet={setWallet} />;
};

export type { WalletProps };
export { PersistentBettingPage as BettingPage };
