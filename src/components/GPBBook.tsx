import React, { useMemo } from 'react';
import { Activity, CalendarRange, Database, Layers3, Settings2, ShieldCheck } from 'lucide-react';
import { Game, SimulationSettings, Team } from '../types';
import { GAMES_PER_SEASON, SEASON_CALENDAR_DAYS } from '../logic/simulation';

interface GPBBookProps {
  teams: Team[];
  games: Game[];
  settings: SimulationSettings;
  currentDate: string;
  dataSource: 'supabase' | 'local';
}

export const GPBBook: React.FC<GPBBookProps> = ({ teams, games, settings, currentDate, dataSource }) => {
  const completedGames = useMemo(() => games.filter((game) => game.status === 'completed').length, [games]);

  const offDayRate = useMemo(() => {
    if (teams.length === 0 || games.length === 0) {
      return 0;
    }

    const playedDays = new Map<string, Set<string>>();
    teams.forEach((team) => playedDays.set(team.id, new Set<string>()));
    games.forEach((game) => {
      playedDays.get(game.homeTeam)?.add(game.date);
      playedDays.get(game.awayTeam)?.add(game.date);
    });

    const totalPossibleTeamDays = teams.length * SEASON_CALENDAR_DAYS;
    const totalPlayedTeamDays = Array.from(playedDays.values()).reduce((sum, dates) => sum + dates.size, 0);
    const rate = 1 - totalPlayedTeamDays / totalPossibleTeamDays;
    return Math.max(0, rate * 100);
  }, [games, teams]);

  const engineCards = [
    {
      title: 'Schedule Generator',
      icon: CalendarRange,
      detail: `Builds a ${GAMES_PER_SEASON}-game schedule over ${SEASON_CALENDAR_DAYS} season days with off days and day-load balancing.`,
    },
    {
      title: 'Simulation Manager',
      icon: Activity,
      detail: 'Runs scoped simulation targets: next game, day, week, month, to date, or full season.',
    },
    {
      title: 'Game Outcome Engine',
      icon: Layers3,
      detail: 'Uses Elo-style win probability + luck noise + Poisson-like run generation to produce realistic scorelines.',
    },
    {
      title: 'Persistence Layer',
      icon: Database,
      detail: 'Writes state to local storage and optionally syncs full league state and season history to Supabase.',
    },
  ];

  const playoffTiebreakers = [
    'Overall regular-season record (W-L)',
    'Run differential (RS - RA)',
    'Home record (Home W-L)',
    'Deterministic fallback (stable seeded hash) if still tied',
  ];

  const playoffRounds = [
    {
      round: 'Wild Card',
      format: 'Best of 3',
      matchups: 'Seed 3 vs Seed 6, Seed 4 vs Seed 5',
      note: 'Seeds 1-2 in each league receive a bye',
    },
    {
      round: 'Divisional',
      format: 'Best of 5',
      matchups: 'Seed 1 vs lowest remaining seed, Seed 2 vs other winner',
      note: 'Higher seed gets home advantage',
    },
    {
      round: 'League Series',
      format: 'Best of 7',
      matchups: 'Prestige champion + Platinum champion are decided here',
      note: 'One series per league (Prestige Series / Platinum Series)',
    },
    {
      round: 'GPB World Series',
      format: 'Best of 7',
      matchups: 'Prestige champion vs Platinum champion',
      note: 'Home advantage by better regular-season seed profile',
    },
  ];

  return (
    <section className="space-y-6">
      <div className="bg-gradient-to-br from-[#1d1d1d] via-[#252525] to-[#1b1b1b] border border-white/10 rounded-2xl p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-4xl md:text-5xl uppercase tracking-widest text-white">GPB Book</h2>
            <p className="font-mono text-xs text-zinc-400 mt-2">League rulebook, simulation architecture, and systems reference.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-right">
            <p className="font-mono text-[11px] uppercase text-zinc-500">Current Sim Date</p>
            <p className="font-mono text-sm text-zinc-200 mt-1">{currentDate || 'Not started'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Teams</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">{teams.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Games Complete</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">{completedGames}/{games.length}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Off-Day Rate</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">{offDayRate.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Data Source</p>
            <p className="font-mono text-lg text-zinc-100 mt-1 uppercase">{dataSource}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <article className="xl:col-span-2 bg-gradient-to-br from-[#1f1f1f] via-[#242424] to-[#1d1d1d] border border-white/10 rounded-2xl p-5">
          <h3 className="font-display text-2xl uppercase tracking-widest text-white mb-4">League Rules & Scheduling Logic</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-1">Season Structure</p>
              <p className="text-sm text-zinc-200">32 teams, 2 leagues, 4 divisions per league, {GAMES_PER_SEASON} games per club over {SEASON_CALENDAR_DAYS} days.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-1">Division Opponents</p>
              <p className="text-sm text-zinc-200">Teams play division rivals 18 times each for core rivalry weight and standings separation.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-1">In-League Opponents</p>
              <p className="text-sm text-zinc-200">Teams play same-league, non-division opponents 7 times each to preserve league identity.</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-1">Interleague Pairing</p>
              <p className="text-sm text-zinc-200">Paired cross-league divisions (North-North, South-South, East-East, West-West) play 4 games.</p>
            </div>
          </div>
        </article>

        <article className="bg-gradient-to-br from-[#1f1f1f] via-[#242424] to-[#1d1d1d] border border-white/10 rounded-2xl p-5">
          <h3 className="font-display text-2xl uppercase tracking-widest text-white mb-4">Commissioner Settings</h3>
          <div className="space-y-2.5">
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="font-mono text-[10px] uppercase text-zinc-500">Continuity Weight</p>
              <p className="font-mono text-base text-zinc-100">{(settings.continuityWeight * 100).toFixed(0)}%</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="font-mono text-[10px] uppercase text-zinc-500">Win/Loss Variance</p>
              <p className="font-mono text-base text-zinc-100">{settings.winLossVariance.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="font-mono text-[10px] uppercase text-zinc-500">Home Field Advantage</p>
              <p className="font-mono text-base text-zinc-100">{settings.homeFieldAdvantage.toFixed(3)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
              <p className="font-mono text-[10px] uppercase text-zinc-500">Game Luck Factor</p>
              <p className="font-mono text-base text-zinc-100">{settings.gameLuckFactor.toFixed(3)}</p>
            </div>
          </div>
        </article>
      </div>

      <article className="bg-gradient-to-br from-[#1f1f1f] via-[#262626] to-[#1d1d1d] border border-white/10 rounded-2xl p-5">
        <h3 className="font-display text-2xl uppercase tracking-widest text-white mb-4">Engine Stack</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {engineCards.map(({ title, icon: Icon, detail }) => (
            <div key={title} className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-platinum" />
                <p className="font-display text-xl uppercase tracking-wide text-zinc-100">{title}</p>
              </div>
              <p className="text-sm text-zinc-300 mt-2">{detail}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="bg-gradient-to-br from-[#1f1f1f] via-[#252525] to-[#1d1d1d] border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-prestige" />
          <h3 className="font-display text-2xl uppercase tracking-widest text-white">How Simulation Runs</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="font-mono text-[10px] uppercase text-zinc-500 mb-1">1. Scope Selection</p>
            <p className="text-zinc-300">Manager receives target scope: next game, day, week, month, to-date, or full season.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="font-mono text-[10px] uppercase text-zinc-500 mb-1">2. Game Resolution</p>
            <p className="text-zinc-300">Each selected game resolves in chronological order with scores, R/H/E, and standings updates.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-zinc-400" />
              <p className="font-mono text-[10px] uppercase text-zinc-500">3. Persist + Notify</p>
            </div>
            <p className="text-zinc-300 mt-1">State is saved and commissioner notifications report results, sync state, and season completion events.</p>
          </div>
        </div>
      </article>

      <article className="bg-gradient-to-br from-[#1d1d1d] via-[#252525] to-[#1a1a1a] border border-white/10 rounded-2xl p-5 md:p-6">
        <h3 className="font-display text-3xl uppercase tracking-widest text-white mb-1">Playoffs Module Blueprint (Draft)</h3>
        <p className="font-mono text-xs text-zinc-500 mb-4">Stored design logic for future engine implementation.</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Leagues</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">2</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Teams Per League</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">6</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Total Playoff Teams</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">12</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Total Rounds</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">4</p>
          </div>
        </div>

        <div className="rounded-xl border border-platinum/25 bg-[linear-gradient(135deg,rgba(23,182,144,0.1),rgba(255,255,255,0.02))] px-4 py-3 mb-4">
          <p className="font-mono text-[11px] uppercase text-zinc-400">Current Engine Status</p>
          <p className="text-sm text-zinc-200 mt-2">
            The `Playoffs` page now uses a live projection engine seeded from current standings. Qualification and ordering use W-L, run differential, and derived home record from completed schedule data.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Qualification + Seeding</h4>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>Per league: 4 division winners + 2 best second-place teams qualify.</p>
              <p>All 6 qualifiers are seeded 1-6 strictly by tiebreak order (not by division title).</p>
              <p>Seeds 1 and 2 in each league receive Wild Card byes.</p>
            </div>
            <div className="mt-3 rounded-lg border border-white/10 bg-[#111] px-3 py-2">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-1">Tiebreak Chain</p>
              <ol className="space-y-1">
                {playoffTiebreakers.map((rule, idx) => (
                  <li key={rule} className="font-mono text-xs text-zinc-300">
                    {idx + 1}. {rule}
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Bracket Flow</h4>
            <div className="space-y-2">
              {playoffRounds.map((item) => (
                <div key={item.round} className="rounded-lg border border-white/10 bg-[#111] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display text-lg uppercase tracking-wide text-zinc-100">{item.round}</p>
                    <p className="font-mono text-xs uppercase text-platinum">{item.format}</p>
                  </div>
                  <p className="font-mono text-xs text-zinc-300 mt-1">{item.matchups}</p>
                  <p className="font-mono text-[11px] text-zinc-500 mt-1">{item.note}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Data Contract For Future Build</h4>
          <div className="bg-[#111] border border-white/10 rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
            <p>TeamSeasonProfile: id, league, division, wins, losses, runDiff, homeWins, homeLosses</p>
            <p className="mt-1">PlayoffSeed: seed, teamId, league, clinchType ('division' | 'wildcard')</p>
            <p className="mt-1">SeriesState: seriesId, round, league, homeTeamId, awayTeamId, bestOf, winsNeeded, homeWins, awayWins</p>
            <p className="mt-1">BracketState: seasonId, prestige, platinum, worldSeries, champion</p>
          </div>
          <p className="font-mono text-[11px] text-zinc-500 mt-2">
            Note: Home record fields are required to fully support your tiebreak logic in code.
          </p>
        </section>
      </article>
    </section>
  );
};
