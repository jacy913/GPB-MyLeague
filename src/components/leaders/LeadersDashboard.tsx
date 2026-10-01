import React, { useMemo } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import type { Player, PlayerSeasonBatting, PlayerSeasonPitching, Team } from '../../types';
import {
  battingMetrics,
  pitchingMetrics,
  toBattingCounts,
  toPitchingCounts,
} from '../../lib/analytics/metrics';
import { leagueBaseline, wrcPlus } from '../../lib/analytics/wrcPlus';
import { summarise } from '../../lib/analytics/percentile';
import { fmtAvg, fmtEra, fmtWhip } from '../../logic/statFormatting';
import { DistributionStrip, Panel, SegmentedControl, StatValue } from '../ui';

/**
 * Leaders, second half: the league as a shape.
 *
 * This is the split the leaders rebuild asked for. The Tables screen answers "who leads
 * a stat" and the percentile column added in Phase 1 answers "how unusual is that". This
 * one answers the question neither can: what does the whole league actually look like,
 * and is the leader out on their own or one of a crowd?
 *
 * ---------------------------------------------------------------------------
 * WHAT IS HERE, AND WHAT IS NOT YET
 * ---------------------------------------------------------------------------
 *
 * Region 1 -- the league frame of reference. Every rate on the Tables screen is
 * unreadable without it, because a number only means something next to the distribution
 * it came from. `leagueBaseline` computes these already and the player and team pages
 * already use it; nothing new was needed to put it here.
 *
 * Region 2 -- distribution strips for the load-bearing rates.
 *
 * NOT YET, and deliberately not faked with placeholder panels:
 *   - the two-variable quadrant plots (Phase 3)
 *   - the splits explorer (Phase 4), which needs a derived split layer
 *   - trend and game-line distributions (Phase 5)
 *
 * ---------------------------------------------------------------------------
 * THE WRC+ IS THE SAME NUMBER THE SIMULATION USES
 * ---------------------------------------------------------------------------
 *
 * `wrcPlus` is what `playerDevelopment.ts` runs to move talent on performance feedback.
 * Showing the league's wRC+ distribution next to the OPS distribution is therefore not a
 * separate model of player quality -- it is the model's own view of the league, made
 * visible. That is the cheapest honest use of the analytics layer this project has.
 *
 * One caveat carried from the plan: `BattingCounts` has no HBP and no sacrifice counts,
 * so the wOBA underneath is a 7-outcome wOBA. wRC+ is league-relative and stays internally
 * consistent -- which is how the rating engine already relies on it -- but its absolute
 * level is not FanGraphs' published value and nothing here implies that it is.
 */

export interface LeadersDashboardProps {
  teams: Team[];
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  onOpenTables: () => void;
}

/** Matches `BATTING_QUALIFYING_AT_BATS` in LeadersHub. */
const QUALIFYING_AB = 82;
/** Matches `PITCHING_QUALIFYING_OUTS` in LeadersHub. */
const QUALIFYING_OUTS = 20;

export const LeadersDashboard: React.FC<LeadersDashboardProps> = ({
  teams,
  players,
  battingStats,
  pitchingStats,
  onOpenTables,
}) => {
  // The same floors the tables use, so the two screens cannot disagree about who counts.
  const qualifiedBatting = useMemo(
    () => battingStats.filter((s) => s.atBats >= QUALIFYING_AB),
    [battingStats],
  );
  const qualifiedPitching = useMemo(
    () => pitchingStats.filter((s) => s.inningsPitched * 3 >= QUALIFYING_OUTS),
    [pitchingStats],
  );

  const batting = useMemo(
    () => qualifiedBatting.map((stat) => battingMetrics(toBattingCounts(stat))),
    [qualifiedBatting],
  );
  const pitching = useMemo(
    () => qualifiedPitching.map((stat) => pitchingMetrics(toPitchingCounts(stat))),
    [qualifiedPitching],
  );

  /**
   * The wRC+ distribution, computed against the league's own baseline.
   *
   * `leagueBaseline` is PA-weighted, which is correct here -- an unweighted mean of
   * player rates would give a 40-PA call-up the same vote as a 600-PA starter -- and it
   * filters on `BASELINE_MINIMUM_PA` internally. So this distribution is over the
   * qualified set and the baseline under it is over the same population.
   */
  const wrc = useMemo(() => {
    const counts = qualifiedBatting.map(toBattingCounts);
    const baseline = leagueBaseline(counts);
    if (!baseline) return null;
    return counts
      .map((row) => wrcPlus(row, baseline).value)
      .filter((v): v is number => v !== null);
  }, [qualifiedBatting]);

  const runsPerGame = useMemo(() => {
    const played = teams.reduce((sum, t) => sum + t.wins + t.losses, 0);
    if (played === 0) return null;
    return teams.reduce((sum, t) => sum + t.runsScored, 0) / played;
  }, [teams]);

  const avgDist = useMemo(
    () => summarise(batting.map((m) => m.avg ?? 0).filter((v) => v > 0), 'desc'),
    [batting],
  );
  const opsDist = useMemo(
    () => summarise(batting.map((m) => m.ops ?? 0).filter((v) => v > 0), 'desc'),
    [batting],
  );
  const isoDist = useMemo(
    () => summarise(batting.map((m) => m.iso ?? 0).filter((v) => v > 0), 'desc'),
    [batting],
  );
  const wrcDist = useMemo(() => summarise(wrc ?? [], 'desc'), [wrc]);
  const eraDist = useMemo(
    () => summarise(pitching.map((m) => m.era ?? 0).filter((v) => v > 0), 'asc'),
    [pitching],
  );
  const whipDist = useMemo(
    () => summarise(pitching.map((m) => m.whip ?? 0).filter((v) => v > 0), 'asc'),
    [pitching],
  );

  const qualifiedHitters = qualifiedBatting.length;
  const qualifiedPitchers = qualifiedPitching.length;

  return (
    <section className="space-y-5">
      <Panel variant="hero" className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="t-h1">
              <BarChart3 className="mr-2 inline h-6 w-6 text-[var(--color-gold)]" aria-hidden="true" />
              Leaders
            </h1>
            <p className="t-body mt-2 max-w-3xl text-[var(--color-ink-dim)]">
              The league as a shape. Every figure below is the frame of reference the tables
              are read against, and the gold line on each strip is its mean.
            </p>
          </div>
          <SegmentedControl
            aria-label="Leaders view"
            mode="fill"
            value="dashboards"
            onChange={(value) => { if (value === 'tables') onOpenTables(); }}
            options={[
              { value: 'tables', label: 'Tables' },
              { value: 'dashboards', label: 'Dashboards' },
            ]}
          />
        </div>
      </Panel>

      {/*
        REGION 1 -- THE FRAME OF REFERENCE.

        Deliberately the first thing on the screen. A .268 on the tables and a 4.12 ERA
        here mean nothing in isolation; they mean something next to each other, and next
        to the strips below them.
      */}
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <span className="t-label">League Baseline</span>
          <span className="t-caption text-[var(--color-ink-faint)]">
            {qualifiedHitters} of {battingStats.length} hitters and {qualifiedPitchers} of{' '}
            {pitchingStats.length} pitchers clear the qualifying floor
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-[var(--color-chrome-lo)] sm:grid-cols-4 lg:grid-cols-7">
          <BaselineCell label="AVG" value={avgDist.size > 0 ? fmtAvg(avgDist.mean) : '-'} />
          <BaselineCell label="OBP" value={fmtAvg(meanOf(batting.map((m) => m.obp ?? 0)))} />
          <BaselineCell label="SLG" value={fmtAvg(meanOf(batting.map((m) => m.slg ?? 0)))} />
          <BaselineCell label="OPS" value={opsDist.size > 0 ? opsDist.mean.toFixed(3) : '-'} />
          <BaselineCell label="ISO" value={isoDist.size > 0 ? fmtAvg(isoDist.mean) : '-'} />
          <BaselineCell label="wRC+" value={wrcDist.size > 0 ? wrcDist.mean.toFixed(0) : '-'} note="100 = league average" />
          <BaselineCell label="ERA" value={eraDist.size > 0 ? fmtEra(eraDist.mean) : '-'} />
          <BaselineCell label="WHIP" value={whipDist.size > 0 ? fmtWhip(whipDist.mean) : '-'} />
          <BaselineCell label="K/9" value={meanOf(pitching.map((m) => m.kPer9 ?? 0)).toFixed(2)} />
          <BaselineCell label="R/G" value={runsPerGame === null ? '-' : runsPerGame.toFixed(1)} note="both leagues" />
          <BaselineCell
            label="QUALIFIED"
            value={`${QUALIFYING_AB} AB`}
            note={`${QUALIFYING_OUTS} outs`}
          />
          <BaselineCell label="TEAMS" value={String(teams.length)} />
          <BaselineCell label="ROSTERS" value={String(players.length)} />
        </div>
      </Panel>

      {/*
        REGION 2 -- DISTRIBUTION STRIPS.

        The gold line is the mean. A strip where almost every bar sits left of that line
        is a league being dragged by one or two players, which is a fact about the league
        that no leaderboard states and that changes how every leaderboard row reads.
      */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel className="p-4">
          <DistributionStrip label="Batting Average" distribution={avgDist} format={fmtAvg} unit="batting average" />
        </Panel>
        <Panel className="p-4">
          <DistributionStrip label="OPS" distribution={opsDist} format={(v) => v.toFixed(3)} unit="on-base plus slugging" />
        </Panel>
        <Panel className="p-4">
          <DistributionStrip label="Isolated Power" distribution={isoDist} format={fmtAvg} unit="isolated power" />
        </Panel>
        <Panel className="p-4">
          <DistributionStrip label="wRC+" distribution={wrcDist} format={(v) => v.toFixed(0)} unit="run value relative to the league" />
        </Panel>
        <Panel className="p-4">
          <DistributionStrip label="ERA" distribution={eraDist} format={(v) => fmtEra(v)} unit="earned run average" />
        </Panel>
        <Panel className="p-4">
          <DistributionStrip label="WHIP" distribution={whipDist} format={(v) => fmtWhip(v)} unit="walks plus hits per inning" />
        </Panel>
      </div>

      {/*
        The honest note, and the same one the Tables screen carries in its short-board
        rows. On day one both pools are empty and every strip renders its empty state; a
        dashboard that showed plausible shapes from four games of baseball would be the
        exact failure this screen was commissioned to avoid.
      */}
      {(qualifiedHitters === 0 || qualifiedPitchers === 0) && (
        <p className="px-1 t-caption text-[var(--color-ink-faint)]">
          {qualifiedHitters === 0 && qualifiedPitchers === 0
            ? `Nobody has reached the qualifying floor yet. Figures appear once a hitter has ${QUALIFYING_AB} at-bats or a pitcher ${QUALIFYING_OUTS} outs.`
            : `Only ${qualifiedHitters === 0 ? 'no hitter' : `${qualifiedHitters} hitter${qualifiedHitters === 1 ? '' : 's'}`} has cleared ${QUALIFYING_AB} at-bats, so the batting figures above cover a very short season.`}
        </p>
      )}

      <p className="flex items-center gap-2 px-1 t-caption text-[var(--color-ink-faint)]">
        <Table2 className="h-3.5 w-3.5" aria-hidden="true" />
        Want the ranked lists?
        <button
          type="button"
          onClick={onOpenTables}
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
        >
          Open the tables
        </button>
      </p>
    </section>
  );
};

/** The unweighted mean of a set, or 0 for an empty one. */
const meanOf = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

/**
 * One cell of the frame of reference.
 *
 * A plain label over a figure. `note` carries the qualifier that makes the figure
 * interpretable -- "100 = league average" under wRC+, for instance -- because a bare 100
 * on a scale nobody remembers is not information.
 */
const BaselineCell: React.FC<{ label: string; value: string; note?: string }> = ({
  label,
  value,
  note,
}) => (
  <div className="bg-[var(--color-panel)] px-3 py-2.5">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className="t-stat-lg tabular-nums">{value}</p>
    {note && <p className="t-caption text-[var(--color-ink-faint)]">{note}</p>}
  </div>
);