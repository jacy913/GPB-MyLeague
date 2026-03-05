import React, { useMemo } from 'react';
import { Activity, CalendarRange, Database, Layers3, PlayCircle, Settings2, ShieldCheck, Users } from 'lucide-react';
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
    {
      title: 'Single Game Engine',
      icon: PlayCircle,
      detail: 'Interactive games should resolve batter-vs-pitcher matchups, track named runners on base, and emit player-attributed play-by-play.',
    },
    {
      title: 'Player Lifecycle Engine',
      icon: Users,
      detail: 'Player state already covers roster ownership, ratings, and seasonal records; the next step is wiring those players directly into game resolution.',
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

  const gameScreenFlow = [
    {
      step: '1. Entry Gate',
      detail: 'When a user opens a game from Games & Schedule or Team Calendar, the system checks that no earlier same-day games remain unsimulated.',
    },
    {
      step: '2. Warning Layer',
      detail: 'If earlier games are still pending, show a warning: this game cannot start cleanly until prior day slots are resolved. Offer "Sim Earlier Games First" or "Back".',
    },
    {
      step: '3. Pregame Screen',
      detail: 'Build a frozen participant snapshot: away lineup, home lineup, batting-order indexes, starting pitchers, and bullpen availability.',
    },
    {
      step: '4. Live Game Loop',
      detail: 'Resolve each plate appearance through batter-vs-pitcher logic, update named runners on base, and credit every hit, walk, strikeout, run, and error to players.',
    },
    {
      step: '5. Finalize + Persist',
      detail: 'At game end, commit the completed game, apply per-player stat deltas, update standings context, and persist both team and player state together.',
    },
  ];

  const atBatOutcomes = [
    'SO: derived from batter avoidStrikeout against pitcher stuff and command',
    'BB: derived from batter plateDiscipline against pitcher control and command',
    'BIP OUT: fielded out after contact, with defense and pitcher fielding shaping the result',
    '1B / 2B / 3B: hit quality derived from contact, power, movement, and runner speed',
    'HR: power outcome driven by batter power against pitcher movement and stuff',
    'ERR: charged to a defender, not to the pitcher as a hit allowed',
  ];

  const gameScreenDataContract = [
    'GameParticipantsSnapshot: awayLineup[], homeLineup[], awayStarterId, homeStarterId, awayBullpen[], homeBullpen[]',
    'GameSessionState: gameId, date, inning, half, outs, basesWithRunnerIds, status, awayBatterIndex, homeBatterIndex, currentAwayPitcherId, currentHomePitcherId',
    'PlayEvent: seq, inning, half, battingTeamId, batterId, pitcherId, defenderId?, outcome, runsScored, rbi, basesBefore, basesAfter, outsBefore, outsAfter',
    'InningLine: inningNumber, awayRuns, homeRuns',
    'PlayerGameStatDelta: batting[playerId], pitching[playerId], fielding[playerId], winningPitcherId?, losingPitcherId?, savePitcherId?',
    'PendingGameGuard: gameId, blockingGameIds[], warningType',
  ];

  const playerGameIntegrationBlueprint = [
    'GameScreen should receive playerState inputs alongside game, teams, and settings so lineups and active pitchers come from real roster slots.',
    'The game session should store runner identity on each base instead of boolean occupancy, so runs and advancements can be credited correctly.',
    'Completed interactive games should return both a completed Game and a player stat delta package; team-only completion is no longer enough.',
    'App-level completion logic should merge those deltas into battingStats and pitchingStats before persisting local or Supabase state.',
  ];

  const playerDrivenUiBlueprint = [
    'Top ribbon: current batter, current pitcher, handedness, fatigue or stamina state, and live matchup context.',
    'Lineup cards: both batting orders with the active hitter highlighted and the next few hitters visible.',
    'Basepaths: runner identities on first, second, and third instead of anonymous occupied bases.',
    'Play log: named events such as "Mateo Garcia doubles off Akira Sato, scoring Luis Cruz."',
    'Postgame box: team line score plus batting and pitching tables attributed to individual players.',
  ];

  const playerDesignCorrections = [
    'Use player_id as UUID everywhere. Do not mix UUID and INT for the same entity.',
    'Do not use team_id as INT if your live teams use text ids like alc and bal. Player ownership should carry league_id + team_id to match the current teams key shape.',
    'Replace one handedness field with bats and throws. Batters may eventually switch-hit, pitchers still only throw left or right.',
    'Use player_type to hard-split batter and pitcher paths. A player can have two positions, but they must stay inside the same role group.',
    'Do not rely on AVG, OPS, ERA, or WHIP as source-of-truth fields. Store raw season totals first, then derive or cache the rate stats.',
    'Avoid is_active as a global lifecycle flag. status should handle active, free_agent, prospect, and retired; add roster_status later only when 26-man or 40-man logic exists.',
  ];

  const playerTableBlueprint = [
    {
      table: 'players',
      purpose: 'Master identity row for every signed player, free agent, prospect, and retired player.',
      fields: [
        'player_id uuid primary key',
        'league_id uuid not null',
        'team_id text null while free agent, prospect, or retired',
        'first_name, last_name',
        "player_type ('batter' | 'pitcher')",
        'primary_position, secondary_position',
        "bats ('L' | 'R' | 'S'), throws ('L' | 'R')",
        'age, potential, status, draft_class_year, draft_round, years_pro, retirement_year',
      ],
    },
    {
      table: 'player_season_batting',
      purpose: 'One batting row per player per season for non-pitchers only.',
      fields: [
        'player_id + season_year unique row',
        'games_played, plate_appearances, at_bats, runs_scored, hits',
        'doubles, triples, home_runs, walks, strikeouts, rbi',
        'avg and ops may be stored as cached values but should be recalculable from totals',
      ],
    },
    {
      table: 'player_season_pitching',
      purpose: 'One pitching row per player per season for SP, RP, and CL roles only.',
      fields: [
        'player_id + season_year unique row',
        'wins, losses, saves, games, games_started',
        'innings_pitched, hits_allowed, earned_runs, walks, strikeouts',
        'era and whip may be cached but should be recalculable from totals',
      ],
    },
    {
      table: 'team_roster_slots',
      purpose: 'Separates roster assignment from player identity so depth charts can change without editing player bios.',
      fields: [
        'league_id, season_year, team_id, slot_code, player_id',
        'slot_code values: C, 1B, 2B, 3B, SS, LF, CF, RF, DH, SP1-SP5, RP1-RP4, CL',
        'one active owner per slot per season',
      ],
    },
  ];

  const playerLifecycleBlueprint = [
    {
      stage: 'Draft Class Pool',
      detail: "Store unsigned incoming players in players with status 'prospect', team_id null, and draft_class_year set.",
    },
    {
      stage: 'Signed / Active',
      detail: "Once drafted or signed, assign league_id + team_id, set status to 'active', and place the player into a team_roster_slots entry.",
    },
    {
      stage: 'Free Agency',
      detail: "When released or unsigned, keep the player row, clear team_id, and set status to 'free_agent' so the market pool stays queryable.",
    },
    {
      stage: 'Retirement',
      detail: "Retired players keep their historical identity and season stats, but status becomes 'retired' and retirement_year is stamped.",
    },
  ];

  const playerGenerationBlueprint = [
    'Name pool weighting: 50% Western, 20% Hispanic, 10% Dutch/Afrikaans, 10% Japanese, 5% Korean, 5% Chinese',
    'Master pool target: 1,000 players',
    'Overall role split target: 45% pitchers, 55% batters',
    'Pitcher split target: 40% SP, 50% RP, 10% CL',
    'Batter split target: even spread across C, 1B, 2B, 3B, SS, LF, CF, RF, DH',
    'Age buckets: 20% prospects (18-22), 60% peak players (23-32), 20% veterans (33-39)',
  ];

  const playerGenerationDesignNotes = [
    'Roster-first rule: 32 teams x 19 slots = 608 active rostered players must exist before the rest of the pool is generated',
    'Because of that roster-first requirement, the live active count should be fixed to 608 in the first pass, with the remaining pool split into free agents and prospects',
    'Peak/veteran age targets should be distributed across active and free-agent players so the total non-prospect pool still matches 600 peak and 200 veteran players',
    'Retired players are not part of the initial 1,000-player seed pool. They should accumulate over future seasons through lifecycle logic',
  ];

  const playerAutoReplenishmentBlueprint = [
    'Threshold check: if active + free_agent players falls below 800, trigger a new draft class',
    'Draft class size: 128 prospects (32 teams x 4 rounds)',
    'Draft class age range: 17-20',
    'Execution model: stored procedure or scheduled Supabase cron job once per simulated season year',
    'Result: long-term leagues keep a stable talent pipeline and avoid player-pool collapse',
  ];

  const draftClassGenerationBlueprint = [
    'Generate 128 draft-eligible prospects each offseason so every team can complete 4 rounds (32 picks per round).',
    'Age distribution target: 17 (10%), 18 (35%), 19 (35%), 20 (20%) to keep upside realistic while still supplying polished options.',
    'Role split target: 56% batters, 44% pitchers; enforce positional minimums so catcher and starting-pitcher pools never run dry.',
    'Each prospect gets hidden true rating + visible scouting band (projected range) so draft outcomes preserve uncertainty.',
    'Assign prospect archetypes (contact, power, speed, command, stuff, movement) to support team-fit logic in AI drafting.',
  ];

  const draftUiBlueprint = [
    'Left-nav `Draft` hub with a live round/pick header, current team on the clock, and commissioner controls (pause, advance pick, auto-run round).',
    'Main board split: Best Available, Team Needs, Pick Feed, and Team War Room panel for the active franchise.',
    'Prospect card essentials: age, role, primary/secondary position, projected OVR band, potential tier, and readiness tag.',
    'Sticky status rail: round progress, next 5 picks, total signed picks, and teams currently over roster limit.',
    'Simulation interruption behavior mirrors trades: show popup `X Draft Picks Ready` and route manually, no forced screen flip.',
  ];

  const fourRoundDraftFlowBlueprint = [
    'Round 1: highest-upside focus, strongest weight on star potential and premium-position scarcity.',
    'Round 2: blend of upside and immediate fit, with stronger team-need weighting.',
    'Round 3: depth and role coverage (bench bats, bullpen arms, defensive specialists).',
    'Round 4: value/risk swings and stash prospects; undrafted players move to free-agent prospect pool.',
  ];

  const draftWaiverBlueprint = [
    'After each pick, run roster-cap check. If the team exceeds active + backup cap, mark a required roster move before next simulation day.',
    'Default behavior: auto-waive lowest-value non-core player from the same role group (batter/pitcher) while preserving lineup + rotation legality.',
    'Legality guard: do not waive players that would break batting-order minimums or drop below minimum starting-pitcher coverage.',
    'Create transaction records for both draft signing and waiver event so the feed remains audit-friendly.',
    'If no legal waive candidate exists, place drafted player in reserve/prospect slot and surface a commissioner warning.',
  ];

  const draftAiLogicBlueprint = [
    'Build team draft profile from record, roster strength by slot, age curve, and organizational direction (contend/retool/rebuild).',
    'Score each prospect using weighted factors: true talent, potential, positional need, scarcity, age-upside, readiness, and variance risk.',
    'Use round-based weight shifts: early rounds bias ceiling, later rounds bias depth fit and near-term utility.',
    'Select with weighted randomness (softmax) among top candidates to avoid deterministic repeated drafts.',
    'Reject choices that create illegal roster states unless auto-waive/reserve rules can immediately resolve them.',
  ];

  const draftLogicBayContract = [
    'DraftProspect: playerId, classYear, age, playerType, positions, projectedOverallLow, projectedOverallHigh, potentialTier, archetype, signability',
    'DraftPickSlot: seasonYear, round, pickNumber, teamId, originalTeamId, status',
    "DraftSelection: seasonYear, round, pickNumber, teamId, playerId, signedStatus ('signed' | 'reserve' | 'declined')",
    'TeamDraftProfile: teamId, direction, needScoresBySlot, ageCurveIndex, riskTolerance',
    "DraftRosterAction: teamId, draftedPlayerId, requiredAction ('none' | 'auto_waive' | 'manual_review'), waivedPlayerId?",
    'DraftRunState: seasonYear, currentRound, currentPick, picksRemaining, isPaused, interruptionReason',
  ];

  const rosterBlueprint = [
    'Batting lineup slots: C, 1B, 2B, 3B, SS, LF, CF, RF, DH',
    'Pitching slots: SP1, SP2, SP3, SP4, SP5, RP1, RP2, RP3, RP4, CL',
    'A player may own up to two positions, but never across batter and pitcher role groups',
    'Suggested validation rule: if player_type = pitcher, only SP/RP/CL are legal positions',
    'Suggested validation rule: if player_type = batter, only field/DH positions are legal positions',
  ];

  const playerDataContract = [
    'PlayerProfile: playerId, leagueId, teamId, firstName, lastName, playerType, primaryPosition, secondaryPosition, bats, throws, age, potential, status',
    'PlayerSeasonBatting: playerId, seasonYear, gamesPlayed, plateAppearances, atBats, runs, hits, doubles, triples, homeRuns, walks, strikeouts, avg, ops',
    'PlayerSeasonPitching: playerId, seasonYear, wins, losses, saves, games, gamesStarted, inningsPitched, hitsAllowed, earnedRuns, walks, strikeouts, era, whip',
    'RosterSlotAssignment: leagueId, seasonYear, teamId, slotCode, playerId',
    'PlayerTransaction: playerId, eventType, fromTeamId, toTeamId, effectiveDate, notes',
    'GameParticipantsSnapshot + PlayerGameStatDelta: the bridge between roster data and interactive game resolution',
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

      <article className="bg-gradient-to-br from-[#1d1d1d] via-[#242424] to-[#191919] border border-white/10 rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-2 mb-3">
          <PlayCircle className="w-4 h-4 text-platinum" />
          <h3 className="font-display text-3xl uppercase tracking-widest text-white">Game Screen Module Blueprint (Draft)</h3>
        </div>
        <p className="font-mono text-xs text-zinc-500 mb-4">
          Design-first logic for turning the current interactive game screen into a player-driven engine with real lineups, pitchers, runner identity, and stat attribution.
        </p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Core Engine</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">Player Matchups</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Default Length</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">9 Innings</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Live Stats</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">R / H / E + Box</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Game Access Rule</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">Chronological</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">User Flow</h4>
            <div className="space-y-2">
              {gameScreenFlow.map((item) => (
                <div key={item.step} className="rounded-lg border border-white/10 bg-[#111] px-3 py-2">
                  <p className="font-mono text-[11px] uppercase text-zinc-400">{item.step}</p>
                  <p className="text-sm text-zinc-300 mt-1">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">At-Bat Outcome Model</h4>
            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">Target Resolution Model</p>
              <p className="font-mono text-xs text-zinc-300">Base outcome should start with batter-vs-pitcher ratings, then apply runner advancement and defensive attribution.</p>
              <p className="font-mono text-xs text-zinc-300 mt-1">First-pass inputs: contact, power, discipline, avoid K, speed, baserunning vs stuff, command, control, movement, stamina, hold runners, and fielding.</p>
              <div className="space-y-1.5 mt-3">
                {atBatOutcomes.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Dedicated Game Screen UI</h4>
            <div className="space-y-2 text-sm text-zinc-300">
              <p>Header: away @ home, team logos, current inning/half, live status.</p>
              <p>Center ribbon: inning-by-inning line score with highlighted active half-inning and current batter/pitcher matchup.</p>
              <p>Field state panel: named runners on base, outs, batting team, current score, and active pitcher.</p>
              <p>Live box: runs, hits, errors, batting order progress, and pitcher stamina update on every plate appearance.</p>
              <p>Play log: named event stream with batter, pitcher, defender, and runners credited directly.</p>
              <p>Controls: step plate appearance, step half inning, simulate inning, simulate to final.</p>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Chronology Guard</h4>
            <div className="rounded-lg border border-prestige/20 bg-prestige/8 px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-400">Required Behavior</p>
              <p className="text-sm text-zinc-300 mt-2">
                If a selected game is not the earliest unresolved game in that day's ordered slate, the user must see a warning before entering the game screen.
              </p>
              <p className="font-mono text-xs text-zinc-500 mt-3">
                Warning copy: earlier games exist on this date and should be simulated first to preserve day order.
              </p>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Player Integration Rules</h4>
          <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
            <div className="space-y-1.5">
              {playerGameIntegrationBlueprint.map((item) => (
                <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Player-Driven UI Additions</h4>
          <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
            <div className="space-y-1.5">
              {playerDrivenUiBlueprint.map((item) => (
                <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Logic Bay Data Contract</h4>
          <div className="bg-[#111] border border-white/10 rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
            {gameScreenDataContract.map((item) => (
              <p key={item} className="mt-1 first:mt-0">{item}</p>
            ))}
          </div>
          <p className="font-mono text-[11px] text-zinc-500 mt-2">
            Implementation target: keep the current bulk season simulator for fast flows, but make the interactive game session return a player-aware stat delta alongside the completed game result.
          </p>
        </section>
      </article>


      <article className="bg-gradient-to-br from-[#1d1d1d] via-[#252525] to-[#1a1a1a] border border-white/10 rounded-2xl p-5 md:p-6">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-platinum" />
          <h3 className="font-display text-3xl uppercase tracking-widest text-white">Player Module Blueprint (Draft)</h3>
        </div>
        <p className="font-mono text-xs text-zinc-500 mb-4">Design-first logic for player identity, roster assignment, season stats, draft intake, free agency, and retirement tracking.</p>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Core Tables</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">4</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Lifecycle States</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">4</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Roster Slots</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">19</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Role Groups</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">Batter / Pitcher</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Draft Rounds</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">4</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Picks Per Round</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">32</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Draft Class Size</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">128</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] uppercase text-zinc-500">Prospect Age Band</p>
            <p className="font-mono text-lg text-zinc-100 mt-1">17-20</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Design Corrections</h4>
            <div className="space-y-2">
              {playerDesignCorrections.map((item) => (
                <div key={item} className="rounded-lg border border-white/10 bg-[#111] px-3 py-2">
                  <p className="text-sm text-zinc-300">{item}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Lifecycle Rules</h4>
            <div className="space-y-2">
              {playerLifecycleBlueprint.map((item) => (
                <div key={item.stage} className="rounded-lg border border-white/10 bg-[#111] px-3 py-2">
                  <p className="font-mono text-[11px] uppercase text-zinc-400">{item.stage}</p>
                  <p className="text-sm text-zinc-300 mt-1">{item.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Generator Targets</h4>
            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <div className="space-y-1.5">
                {playerGenerationBlueprint.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Generator Constraints</h4>
            <div className="space-y-2">
              {playerGenerationDesignNotes.map((item) => (
                <div key={item} className="rounded-lg border border-white/10 bg-[#111] px-3 py-2">
                  <p className="text-sm text-zinc-300">{item}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Recommended Supabase Tables</h4>
            <div className="space-y-2">
              {playerTableBlueprint.map((item) => (
                <div key={item.table} className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
                  <p className="font-display text-lg uppercase tracking-wide text-zinc-100">{item.table}</p>
                  <p className="text-sm text-zinc-300 mt-1">{item.purpose}</p>
                  <div className="mt-2 space-y-1">
                    {item.fields.map((field) => (
                      <p key={field} className="font-mono text-[11px] text-zinc-400">{field}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Roster Logic</h4>
            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">Depth Chart Rules</p>
              <div className="space-y-1.5">
                {rosterBlueprint.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-platinum/20 bg-platinum/10 px-3 py-3 mt-3">
              <p className="font-mono text-[11px] uppercase text-zinc-400">Pragmatic Recommendation</p>
              <p className="text-sm text-zinc-300 mt-2">
                Keep draft classes, free agents, active players, and retired players inside one master players table first. Add dedicated draft-room or contract tables only when those systems become interactive modules.
              </p>
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Automatic Draft-Class Replenishment</h4>
          <div className="rounded-lg border border-platinum/20 bg-platinum/10 px-3 py-3">
            <div className="space-y-1.5">
              {playerAutoReplenishmentBlueprint.map((item) => (
                <p key={item} className="font-mono text-[11px] text-zinc-300">{item}</p>
              ))}
            </div>
          </div>
          <p className="font-mono text-[11px] text-zinc-500 mt-2">
            Recommended future implementation: use a database-side scheduler for annual replenishment, but keep the player-generator logic deterministic and reusable in app code first.
          </p>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Draft System Blueprint (Logic Bay)</h4>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">Draft Class Generation</p>
              <div className="space-y-1.5">
                {draftClassGenerationBlueprint.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">Draft UI Direction</p>
              <div className="space-y-1.5">
                {draftUiBlueprint.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">Four-Round Flow</p>
              <div className="space-y-1.5">
                {fourRoundDraftFlowBlueprint.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3">
              <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">Post-Pick Waiver Handling</p>
              <div className="space-y-1.5">
                {draftWaiverBlueprint.map((item) => (
                  <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-[#111] px-3 py-3 mt-4">
            <p className="font-mono text-[11px] uppercase text-zinc-500 mb-2">AI Team Drafting Model</p>
            <div className="space-y-1.5">
              {draftAiLogicBlueprint.map((item) => (
                <p key={item} className="font-mono text-[11px] text-zinc-400">{item}</p>
              ))}
            </div>
          </div>

          <div className="bg-[#111] border border-white/10 rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto mt-4">
            <p className="text-zinc-500 uppercase text-[11px] mb-2">Draft Logic Bay Data Contract</p>
            {draftLogicBayContract.map((item) => (
              <p key={item} className="mt-1 first:mt-0">{item}</p>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 mt-4">
          <h4 className="font-display text-xl uppercase tracking-wide text-zinc-100 mb-2">Logic Bay Data Contract</h4>
          <div className="bg-[#111] border border-white/10 rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
            {playerDataContract.map((item) => (
              <p key={item} className="mt-1 first:mt-0">{item}</p>
            ))}
          </div>
          <p className="font-mono text-[11px] text-zinc-500 mt-2">
            Schema direction: player identity, player season stats, and roster slot assignment should remain separate so team pages, transactions, and long-term career history stay stable.
          </p>
        </section>
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
