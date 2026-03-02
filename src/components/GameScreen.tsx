import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Clock3, FastForward, Play, SkipForward } from 'lucide-react';
import {
  CompletedGameResult,
  Game,
  GameParticipantBatter,
  GameParticipantPitcher,
  GameSessionState,
  LeaguePlayerState,
  PlayLogEvent,
  SimulationSettings,
  Team,
} from '../types';
import {
  buildCompletedGameFromSession,
  createGameSession,
  hydrateGameSessionFromGame,
  simulateGameToFinal,
  simulateNextAtBat,
  simulateNextHalfInning,
  startGameSession,
} from '../logic/gameEngine';
import { buildGameParticipants } from '../logic/gameParticipants';
import { getCurrentSimTimeLabel, getGameWindowStatus, getScheduledGameTimeLabel } from '../logic/gameTimes';
import { TeamLogo } from './TeamLogo';

interface GameScreenProps {
  game: Game;
  games: Game[];
  teams: Team[];
  playerState: LeaguePlayerState;
  settings: SimulationSettings;
  currentDate: string;
  blockingGames: Game[];
  onBack: () => void;
  onSimulateBlockingGames: () => void;
  onCompleteGame: (result: CompletedGameResult) => void;
}

const LOG_REVEAL_DELAY_MS = 425;

const getOrdinal = (value: number): string => {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  const last = value % 10;
  if (last === 1) return `${value}st`;
  if (last === 2) return `${value}nd`;
  if (last === 3) return `${value}rd`;
  return `${value}th`;
};

const parseStoredLogs = (game: Game): PlayLogEvent[] => {
  const raw = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as PlayLogEvent[];
  } catch {
    return [];
  }
};

const createEmptyBroadcastSession = (
  game: Game,
  started: boolean,
  participants: GameSessionState['participants'],
): GameSessionState => ({
  gameId: game.gameId,
  date: game.date,
  awayTeamId: game.awayTeam,
  homeTeamId: game.homeTeam,
  participants,
  status: started ? 'in_progress' : 'pregame',
  inning: 1,
  half: 'top',
  outs: 0,
  bases: { first: null, second: null, third: null },
  awayBatterIndex: 0,
  homeBatterIndex: 0,
  awayPitching: { currentPitcherId: participants?.awayStarter?.playerId ?? null, pitchCount: 0, battersFaced: 0, enteredInning: 1, bullpenUsedIds: [] },
  homePitching: { currentPitcherId: participants?.homeStarter?.playerId ?? null, pitchCount: 0, battersFaced: 0, enteredInning: 1, bullpenUsedIds: [] },
  scoreboard: {
    awayRuns: 0,
    homeRuns: 0,
    awayHits: 0,
    homeHits: 0,
    awayErrors: 0,
    homeErrors: 0,
  },
  lineScore: [],
  logs: [],
  playerStats: {
    batting: {},
    pitching: {},
    winningPitcherId: null,
    losingPitcherId: null,
    savePitcherId: null,
  },
  nextEventSeq: 1,
});

const ensureLineScoreEntry = (lineScore: GameSessionState['lineScore'], inning: number) => {
  let line = lineScore.find((entry) => entry.inning === inning);
  if (!line) {
    line = { inning, away: 0, home: 0 };
    lineScore.push(line);
    lineScore.sort((left, right) => left.inning - right.inning);
  }
  return line;
};

const buildBroadcastSession = (
  game: Game,
  revealedLogs: PlayLogEvent[],
  hasStarted: boolean,
  participants: GameSessionState['participants'],
): GameSessionState => {
  const snapshot = createEmptyBroadcastSession(game, hasStarted, participants);

  for (const log of revealedLogs) {
    snapshot.logs.push(log);
    snapshot.nextEventSeq = Math.max(snapshot.nextEventSeq, log.seq + 1);

    if (log.outcome === 'HALF_END') {
      ensureLineScoreEntry(snapshot.lineScore, log.inning);
      snapshot.outs = 0;
      snapshot.bases = { first: null, second: null, third: null };
      if (log.half === 'top') {
        snapshot.half = 'bottom';
        snapshot.inning = log.inning;
      } else {
        snapshot.half = 'top';
        snapshot.inning = log.inning + 1;
      }
      continue;
    }

    snapshot.status = 'in_progress';
    snapshot.inning = log.inning;
    snapshot.half = log.half;
    snapshot.outs = log.outs;
    snapshot.bases = { ...log.bases };
    snapshot.scoreboard.awayRuns = log.scoreAway;
    snapshot.scoreboard.homeRuns = log.scoreHome;
    ensureLineScoreEntry(snapshot.lineScore, log.inning);

    if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
      if (log.battingTeamId === game.awayTeam) {
        snapshot.scoreboard.awayHits += 1;
      } else {
        snapshot.scoreboard.homeHits += 1;
      }
    }

    if (log.outcome === 'ERR') {
      if (log.battingTeamId === game.awayTeam) {
        snapshot.scoreboard.homeErrors += 1;
      } else {
        snapshot.scoreboard.awayErrors += 1;
      }
    }

    if (log.runsScored > 0) {
      const inningLine = ensureLineScoreEntry(snapshot.lineScore, log.inning);
      if (log.battingTeamId === game.awayTeam) {
        inningLine.away += log.runsScored;
      } else {
        inningLine.home += log.runsScored;
      }
    }

    if (log.outcome === 'GAME_END') {
      snapshot.status = 'completed';
      snapshot.bases = { first: null, second: null, third: null };
    }
  }

  return snapshot;
};

const BasesDiamond: React.FC<{ first: boolean; second: boolean; third: boolean }> = ({ first, second, third }) => (
  <div className="relative mx-auto h-40 w-40">
    <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-md border border-white/10 bg-white/[0.03]" />
    <div className={`absolute bottom-3 left-1/2 h-5 w-5 -translate-x-1/2 rotate-45 rounded-sm border ${first ? 'border-platinum bg-platinum' : 'border-white/15 bg-[#191919]'}`} />
    <div className={`absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 rotate-45 rounded-sm border ${third ? 'border-platinum bg-platinum' : 'border-white/15 bg-[#191919]'}`} />
    <div className={`absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 rotate-45 rounded-sm border ${second ? 'border-platinum bg-platinum' : 'border-white/15 bg-[#191919]'}`} />
    <div className="absolute left-1/2 top-5 h-5 w-5 -translate-x-1/2 rotate-45 rounded-sm border border-white/10 bg-white/10" />
  </div>
);

const getCurrentBatterForDisplay = (session: GameSessionState): GameParticipantBatter | null => {
  if (!session.participants) {
    return null;
  }

  const lineup = session.half === 'top' ? session.participants.awayLineup : session.participants.homeLineup;
  const index = session.half === 'top' ? session.awayBatterIndex : session.homeBatterIndex;
  if (lineup.length === 0) {
    return null;
  }

  return lineup[index % lineup.length] ?? null;
};

const getCurrentPitcherForDisplay = (session: GameSessionState): GameParticipantPitcher | null => {
  if (!session.participants) {
    return null;
  }

  const pitchingState = session.half === 'top' ? session.homePitching : session.awayPitching;
  const options = session.half === 'top'
    ? [session.participants.homeStarter, ...session.participants.homeBullpen]
    : [session.participants.awayStarter, ...session.participants.awayBullpen];

  return options.find((pitcher): pitcher is GameParticipantPitcher => Boolean(pitcher) && pitcher.playerId === pitchingState.currentPitcherId) ?? null;
};

export const GameScreen: React.FC<GameScreenProps> = ({
  game,
  games,
  teams,
  playerState,
  settings,
  currentDate,
  blockingGames,
  onBack,
  onSimulateBlockingGames,
  onCompleteGame,
}) => {
  const awayTeam = useMemo(() => teams.find((team) => team.id === game.awayTeam) ?? null, [teams, game.awayTeam]);
  const homeTeam = useMemo(() => teams.find((team) => team.id === game.homeTeam) ?? null, [teams, game.homeTeam]);
  const participants = useMemo(() => buildGameParticipants(game, games, playerState), [game, games, playerState]);
  const [session, setSession] = useState<GameSessionState | null>(null);
  const [visibleLogCount, setVisibleLogCount] = useState(0);
  const [pendingCompletedGame, setPendingCompletedGame] = useState<CompletedGameResult | null>(null);
  const logViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hydrated = hydrateGameSessionFromGame(game);
    setSession(hydrated ?? createGameSession(game, participants));
    setPendingCompletedGame(null);
    setVisibleLogCount(game.status === 'completed' ? parseStoredLogs(game).length : 0);
  }, [game, participants]);

  const logs = useMemo(() => {
    if (session && session.logs.length > 0) {
      return session.logs;
    }
    return parseStoredLogs(game);
  }, [session, game]);
  const visibleLogs = useMemo(() => logs.slice(0, visibleLogCount), [logs, visibleLogCount]);
  const isBroadcasting = visibleLogCount < logs.length;
  const activeSession = useMemo(() => session ?? createGameSession(game, participants), [session, game, participants]);
  const displaySession = useMemo(
    () => (isBroadcasting ? buildBroadcastSession(game, visibleLogs, activeSession.status !== 'pregame', activeSession.participants) : activeSession),
    [isBroadcasting, game, visibleLogs, activeSession],
  );
  const lineScore = displaySession.lineScore;
  const displayAwayRuns = displaySession.scoreboard.awayRuns;
  const displayHomeRuns = displaySession.scoreboard.homeRuns;
  const displayAwayHits = displaySession.scoreboard.awayHits;
  const displayHomeHits = displaySession.scoreboard.homeHits;
  const displayAwayErrors = displaySession.scoreboard.awayErrors;
  const displayHomeErrors = displaySession.scoreboard.homeErrors;
  const scheduledTimeLabel = useMemo(() => getScheduledGameTimeLabel(game, games), [game, games]);
  const currentSimTimeLabel = useMemo(() => getCurrentSimTimeLabel(games, currentDate), [games, currentDate]);
  const gameWindowStatus = useMemo(() => getGameWindowStatus(game, games, currentDate), [game, games, currentDate]);
  const statusLabel =
    displaySession.status === 'completed'
      ? 'Final'
      : displaySession.status === 'pregame'
        ? gameWindowStatus === 'live_window'
          ? 'Live Window'
          : 'Pregame'
        : `${displaySession.half === 'top' ? 'Top' : 'Bot'} ${getOrdinal(displaySession.inning)}`;
  const gameWindowLabel =
    displaySession.status === 'completed'
      ? 'Final'
      : displaySession.status === 'in_progress'
        ? 'In Progress'
        : gameWindowStatus === 'live_window'
          ? 'Live Window'
          : 'Not Started';
  const currentBatter = useMemo(() => getCurrentBatterForDisplay(activeSession), [activeSession]);
  const currentPitcher = useMemo(() => getCurrentPitcherForDisplay(activeSession), [activeSession]);
  const participantNamesById = useMemo(() => {
    const map = new Map<string, string>();
    activeSession.participants?.awayLineup.forEach((participant) => map.set(participant.playerId, participant.fullName));
    activeSession.participants?.homeLineup.forEach((participant) => map.set(participant.playerId, participant.fullName));
    activeSession.participants?.awayStarter && map.set(activeSession.participants.awayStarter.playerId, activeSession.participants.awayStarter.fullName);
    activeSession.participants?.homeStarter && map.set(activeSession.participants.homeStarter.playerId, activeSession.participants.homeStarter.fullName);
    activeSession.participants?.awayBullpen.forEach((participant) => map.set(participant.playerId, participant.fullName));
    activeSession.participants?.homeBullpen.forEach((participant) => map.set(participant.playerId, participant.fullName));
    return map;
  }, [activeSession.participants]);
  const runnerLabels = {
    first: displaySession.bases.first ? participantNamesById.get(displaySession.bases.first) ?? 'Runner on 1st' : 'Empty',
    second: displaySession.bases.second ? participantNamesById.get(displaySession.bases.second) ?? 'Runner on 2nd' : 'Empty',
    third: displaySession.bases.third ? participantNamesById.get(displaySession.bases.third) ?? 'Runner on 3rd' : 'Empty',
  };
  const noParticipants = !activeSession.participants && game.status !== 'completed';

  useEffect(() => {
    if (game.status === 'completed') {
      setVisibleLogCount(logs.length);
      return;
    }

    if (!session || session.status === 'pregame') {
      setVisibleLogCount(0);
      return;
    }

    if (visibleLogCount >= logs.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      setVisibleLogCount((previous) => Math.min(previous + 1, logs.length));
    }, LOG_REVEAL_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [game.status, logs.length, session, visibleLogCount]);

  useEffect(() => {
    if (!pendingCompletedGame || visibleLogCount < logs.length) {
      return;
    }

    onCompleteGame(pendingCompletedGame);
    setPendingCompletedGame(null);
  }, [pendingCompletedGame, visibleLogCount, logs.length, onCompleteGame]);

  useEffect(() => {
    if (!logViewportRef.current || visibleLogs.length === 0) {
      return;
    }

    logViewportRef.current.scrollTo({
      top: logViewportRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [visibleLogs.length]);

  const commitSessionIfComplete = (nextSession: GameSessionState) => {
    setSession(nextSession);
    if (nextSession.status === 'completed') {
      setPendingCompletedGame(buildCompletedGameFromSession(game, nextSession));
    }
  };

  const handleStart = () => {
    if (!session || noParticipants) return;
    setSession(startGameSession(session));
  };

  const handleNextAtBat = () => {
    if (!session || !awayTeam || !homeTeam || noParticipants) return;
    commitSessionIfComplete(simulateNextAtBat(session, awayTeam, homeTeam, settings));
  };

  const handleNextHalf = () => {
    if (!session || !awayTeam || !homeTeam || noParticipants) return;
    commitSessionIfComplete(simulateNextHalfInning(session, awayTeam, homeTeam, settings));
  };

  const handleSimToFinal = () => {
    if (!session || !awayTeam || !homeTeam || noParticipants) return;
    commitSessionIfComplete(simulateGameToFinal(session, awayTeam, homeTeam, settings));
  };

  const handleSkipBroadcast = () => {
    setVisibleLogCount(logs.length);
  };

  if (!awayTeam || !homeTeam || !session) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#191919] p-6">
        <button onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <p className="font-mono text-sm text-zinc-400">Unable to load this game.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
        <ArrowLeft className="w-4 h-4" />
        Back to Schedule
      </button>

      {blockingGames.length > 0 && game.status === 'scheduled' && (
        <div className="rounded-2xl border border-prestige/20 bg-prestige/8 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-prestige shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="font-display text-2xl uppercase tracking-[0.12em] text-white">Earlier Games Need Resolution</h2>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-400 mt-2">
                This game is not the earliest unresolved game on {game.date}. Resolve the earlier slate first to preserve day order.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {blockingGames.map((blockingGame) => (
                  <span key={blockingGame.gameId} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-zinc-200">
                    {blockingGame.awayTeam.toUpperCase()} @ {blockingGame.homeTeam.toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={onSimulateBlockingGames}
                  className="inline-flex items-center gap-2 rounded-xl bg-prestige px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-black"
                >
                  <FastForward className="w-4 h-4" />
                  Sim Earlier Games First
                </button>
                <button
                  onClick={onBack}
                  className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-zinc-200"
                >
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {noParticipants && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-5">
          <p className="font-display text-2xl uppercase tracking-[0.12em] text-white">Player Snapshot Missing</p>
          <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300">
            Generate or assign rostered players before using the interactive player-driven game screen.
          </p>
        </div>
      )}

      <div className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(135deg,#161616,#1f1f1f,#141414)] p-5 md:p-6">
        <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_260px] gap-5 items-start">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Batting Side</p>
            <div className="mt-4 flex items-center gap-3">
              <TeamLogo
                team={displaySession.half === 'top' ? awayTeam : homeTeam}
                sizeClass="w-20 h-20"
              />
              <div>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white leading-none">
                  {displaySession.half === 'top' ? awayTeam.city : homeTeam.city}
                </p>
                <p className="font-display text-lg uppercase tracking-[0.1em] text-zinc-400 mt-1">
                  {displaySession.half === 'top' ? awayTeam.name : homeTeam.name}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">R</p>
                <p className="font-mono text-xl text-zinc-100 mt-1">
                  {displaySession.half === 'top' ? displayAwayRuns : displayHomeRuns}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">H</p>
                <p className="font-mono text-xl text-zinc-100 mt-1">
                  {displaySession.half === 'top' ? displayAwayHits : displayHomeHits}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">E</p>
                <p className="font-mono text-xl text-zinc-100 mt-1">
                  {displaySession.half === 'top' ? displayAwayErrors : displayHomeErrors}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{game.date}</p>
                <h1 className="font-display text-4xl uppercase tracking-[0.12em] text-white mt-1">
                  {awayTeam.city} at {homeTeam.city}
                </h1>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">First Pitch</p>
                    <p className="mt-1 inline-flex items-center gap-2 font-mono text-sm text-zinc-100">
                      <Clock3 className="h-3.5 w-3.5 text-platinum" />
                      {scheduledTimeLabel}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Sim Clock</p>
                    <p className="mt-1 font-mono text-sm text-zinc-100">{currentSimTimeLabel}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Window</p>
                    <p className="mt-1 font-display text-sm uppercase tracking-[0.1em] text-zinc-100">{gameWindowLabel}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-4 py-3 text-right min-w-[180px]">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Status</p>
                <p className="font-display text-2xl uppercase tracking-[0.1em] text-white mt-1">{statusLabel}</p>
                {isBroadcasting && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-platinum">
                    Broadcast Feed Live
                  </p>
                )}
              </div>
            </div>

            {activeSession.participants && (
              <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-[#111] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current Batter</p>
                  <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">{currentBatter?.fullName ?? '---'}</p>
                  <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-zinc-400">
                    {currentBatter ? `${currentBatter.primaryPosition} | Bats ${currentBatter.bats} | CON ${currentBatter.battingRatings.contact} | PWR ${currentBatter.battingRatings.power}` : 'Awaiting matchup'}
                  </p>
                  <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                    {currentBatter?.battingStat
                      ? `${currentBatter.battingStat.avg.toFixed(3).replace(/^0/, '')} AVG | ${currentBatter.battingStat.ops.toFixed(3)} OPS | ${currentBatter.battingStat.homeRuns} HR`
                      : 'No season batting line loaded'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current Pitcher</p>
                  <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">{currentPitcher?.fullName ?? '---'}</p>
                  <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-zinc-400">
                    {currentPitcher
                      ? `${currentPitcher.role} | Throws ${currentPitcher.throws} | STF ${currentPitcher.pitchingRatings.stuff} | CMD ${currentPitcher.pitchingRatings.command} | PC ${displaySession.half === 'top' ? activeSession.homePitching.pitchCount : activeSession.awayPitching.pitchCount}`
                      : 'Awaiting matchup'}
                  </p>
                  <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                    {currentPitcher?.pitchingStat
                      ? `${currentPitcher.pitchingStat.era.toFixed(2)} ERA | ${currentPitcher.pitchingStat.whip.toFixed(2)} WHIP | ${currentPitcher.pitchingStat.strikeouts} K`
                      : 'No season pitching line loaded'}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_180px] gap-4 items-center">
              <div className="overflow-x-auto scrollbar-subtle">
                <table className="min-w-full font-mono text-sm">
                  <thead>
                    <tr className="text-zinc-500">
                      <th className="px-2 py-1 text-left uppercase">Team</th>
                      {Array.from({ length: Math.max(9, lineScore.length) }, (_, index) => (
                        <th key={index} className="px-2 py-1 text-center">{index + 1}</th>
                      ))}
                      <th className="px-2 py-1 text-center">R</th>
                      <th className="px-2 py-1 text-center">H</th>
                      <th className="px-2 py-1 text-center">E</th>
                      <th className="px-2 py-1 text-center">O</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-zinc-100">
                      <td className="px-2 py-2 uppercase">{awayTeam.id}</td>
                      {Array.from({ length: Math.max(9, lineScore.length) }, (_, index) => (
                        <td key={index} className="px-2 py-2 text-center">{lineScore[index]?.away ?? ''}</td>
                      ))}
                      <td className="px-2 py-2 text-center">{displayAwayRuns}</td>
                      <td className="px-2 py-2 text-center">{displayAwayHits}</td>
                      <td className="px-2 py-2 text-center">{displayAwayErrors}</td>
                      <td className="px-2 py-2 text-center">{displaySession.half === 'top' ? displaySession.outs : ''}</td>
                    </tr>
                    <tr className="text-zinc-100">
                      <td className="px-2 py-2 uppercase">{homeTeam.id}</td>
                      {Array.from({ length: Math.max(9, lineScore.length) }, (_, index) => (
                        <td key={index} className="px-2 py-2 text-center">{lineScore[index]?.home ?? ''}</td>
                      ))}
                      <td className="px-2 py-2 text-center">{displayHomeRuns}</td>
                      <td className="px-2 py-2 text-center">{displayHomeHits}</td>
                      <td className="px-2 py-2 text-center">{displayHomeErrors}</td>
                      <td className="px-2 py-2 text-center">{displaySession.half === 'bottom' ? displaySession.outs : ''}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <BasesDiamond
                first={Boolean(displaySession.bases.first)}
                second={Boolean(displaySession.bases.second)}
                third={Boolean(displaySession.bases.third)}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">First Base</p>
                <p className="mt-1 text-sm text-zinc-100">{runnerLabels.first}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">Second Base</p>
                <p className="mt-1 text-sm text-zinc-100">{runnerLabels.second}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">Third Base</p>
                <p className="mt-1 text-sm text-zinc-100">{runnerLabels.third}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">Away</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-1">{displayAwayRuns}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">Home</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-1">{displayHomeRuns}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">Outs</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-1">{displaySession.outs}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">Active Half</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-1">
                  {displaySession.half === 'top' ? 'Top' : 'Bot'}
                </p>
              </div>
            </div>

            {activeSession.participants && (
              <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-[#111] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Away Lineup</p>
                  <div className="mt-3 space-y-1.5">
                    {activeSession.participants.awayLineup.map((participant, index) => (
                      <div
                        key={participant.playerId}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${displaySession.half === 'top' && currentBatter?.playerId === participant.playerId ? 'bg-white/10' : 'bg-black/20'}`}
                      >
                        <span className="text-sm text-zinc-100">{index + 1}. {participant.fullName}</span>
                        <span className="font-mono text-xs uppercase text-zinc-500">{participant.primaryPosition}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#111] px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Home Lineup</p>
                  <div className="mt-3 space-y-1.5">
                    {activeSession.participants.homeLineup.map((participant, index) => (
                      <div
                        key={participant.playerId}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 ${displaySession.half === 'bottom' && currentBatter?.playerId === participant.playerId ? 'bg-white/10' : 'bg-black/20'}`}
                      >
                        <span className="text-sm text-zinc-100">{index + 1}. {participant.fullName}</span>
                        <span className="font-mono text-xs uppercase text-zinc-500">{participant.primaryPosition}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              {session.status === 'pregame' && blockingGames.length === 0 && game.status !== 'completed' && (
                <button
                  onClick={handleStart}
                  disabled={noParticipants}
                  className="inline-flex items-center gap-2 rounded-xl bg-platinum px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-black disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Start Game
                </button>
              )}
              {session.status === 'in_progress' && (
                <>
                  <button
                    onClick={handleNextAtBat}
                    disabled={isBroadcasting || noParticipants}
                    className="inline-flex items-center gap-2 rounded-xl bg-platinum px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-black disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Next At-Bat
                  </button>
                  <button
                    onClick={handleNextHalf}
                    disabled={isBroadcasting || noParticipants}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <SkipForward className="w-4 h-4" />
                    Next Half Inning
                  </button>
                  <button
                    onClick={handleSimToFinal}
                    disabled={isBroadcasting || noParticipants}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FastForward className="w-4 h-4" />
                    Sim To Final
                  </button>
                </>
              )}
              {session.status === 'completed' && (
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-2 font-mono text-sm text-zinc-200">
                  {isBroadcasting
                    ? `Broadcast finishing. ${visibleLogs.length}/${logs.length} plays on screen.`
                    : `Game complete. Final score ${displayAwayRuns}-${displayHomeRuns}.`}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Pitching Side</p>
            <div className="mt-4 flex items-center gap-3">
              <TeamLogo
                team={displaySession.half === 'top' ? homeTeam : awayTeam}
                sizeClass="w-20 h-20"
              />
              <div>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white leading-none">
                  {displaySession.half === 'top' ? homeTeam.city : awayTeam.city}
                </p>
                <p className="font-display text-lg uppercase tracking-[0.1em] text-zinc-400 mt-1">
                  {displaySession.half === 'top' ? homeTeam.name : awayTeam.name}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">R</p>
                <p className="font-mono text-xl text-zinc-100 mt-1">
                  {displaySession.half === 'top' ? displayHomeRuns : displayAwayRuns}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">H</p>
                <p className="font-mono text-xl text-zinc-100 mt-1">
                  {displaySession.half === 'top' ? displayHomeHits : displayAwayHits}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                <p className="font-mono text-[10px] uppercase text-zinc-500">E</p>
                <p className="font-mono text-xl text-zinc-100 mt-1">
                  {displaySession.half === 'top' ? displayHomeErrors : displayAwayErrors}
                </p>
              </div>
            </div>
          </div>

          <div className="xl:col-span-3">
            <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Play Log</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    {visibleLogs.length}/{logs.length} events shown
                  </p>
                </div>
                {isBroadcasting && (
                  <button
                    onClick={handleSkipBroadcast}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111] px-4 py-2 font-display text-sm uppercase tracking-[0.12em] text-zinc-100 hover:border-white/20"
                  >
                    <FastForward className="h-4 w-4" />
                    Skip Broadcast
                  </button>
                )}
              </div>
              <div ref={logViewportRef} className="mt-4 max-h-[420px] overflow-y-auto scrollbar-subtle space-y-2 pr-1">
                {visibleLogs.length === 0 ? (
                  <p className="font-mono text-xs text-zinc-500">No play log available yet.</p>
                ) : (
                  visibleLogs.map((log) => (
                    <div key={log.seq} className="rounded-xl border border-white/10 bg-[#111] px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                          {log.half === 'top' ? 'Top' : 'Bot'} {log.inning}
                        </p>
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                          {log.scoreAway}-{log.scoreHome}
                        </p>
                      </div>
                      <p className="mt-1 text-sm text-zinc-200">{log.description}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
