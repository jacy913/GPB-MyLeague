import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, FastForward, MapPinned, Play, SkipForward } from 'lucide-react';
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
import { Panel, RetroButton } from './ui';
import { BaseDiamond, CountTile, LineScore, SidePanel } from './game/shared';
import { GameClock, LineupList, MatchupCard, PlayLog } from './game/GamePanels';
import { ParkPanel } from './game/ParkPanel';

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

const BASE_LOG_REVEAL_DELAY_MS = 95;
const FAST_LOG_REVEAL_DELAY_MS = 40;

const getLogRevealBatchSize = (totalLogs: number): number => {
  if (totalLogs >= 220) return 8;
  if (totalLogs >= 140) return 6;
  if (totalLogs >= 90) return 4;
  if (totalLogs >= 45) return 3;
  return 1;
};

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
  randomState: 1,
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
  const [isParkOpen, setIsParkOpen] = useState(false);
  /*
    `<HTMLOListElement>`, because this ref is handed to the play-by-play `<ol>`.

    It was declared as a div. The only thing done with it is `scrollTo`, which both element types
    have, so nothing was ever wrong at runtime -- but a ref typed for one element and attached to
    another is the kind of mismatch that gets copied into the next component and then does break.
  */
  const logViewportRef = useRef<HTMLOListElement | null>(null);
  const storedLogs = useMemo(() => parseStoredLogs(game), [game.gameId, game.stats.playLog]);

  useEffect(() => {
    const hydrated = hydrateGameSessionFromGame(game);
    setSession(hydrated ?? createGameSession(game, participants));
    setPendingCompletedGame(null);
    setVisibleLogCount(game.status === 'completed' ? storedLogs.length : 0);
  }, [game, participants, storedLogs.length]);

  const logs = useMemo(() => {
    if (session && session.logs.length > 0) {
      return session.logs;
    }
    return storedLogs;
  }, [session, storedLogs]);
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

    const step = getLogRevealBatchSize(logs.length);
    const delayMs = session.status === 'completed' ? FAST_LOG_REVEAL_DELAY_MS : BASE_LOG_REVEAL_DELAY_MS;
    const timer = window.setTimeout(() => {
      setVisibleLogCount((previous) => Math.min(previous + step, logs.length));
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [game.status, logs.length, session, visibleLogCount]);

  useEffect(() => {
    if (!pendingCompletedGame) {
      return;
    }

    setVisibleLogCount((current) => Math.max(current, logs.length));
    onCompleteGame(pendingCompletedGame);
    setPendingCompletedGame(null);
  }, [pendingCompletedGame, logs.length, onCompleteGame]);

  useEffect(() => {
    if (!logViewportRef.current || visibleLogs.length === 0) {
      return;
    }

    logViewportRef.current.scrollTo({
      top: logViewportRef.current.scrollHeight,
      behavior: 'auto',
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
      <section className="space-y-3">
        <RetroButton variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
        </RetroButton>
        <Panel variant="sunken" className="p-4">
          <p className="t-body text-[var(--color-ink-dim)]">Unable to load this game.</p>
        </Panel>
      </section>
    );
  }

  const isTopHalf = displaySession.half === 'top';
  const battingTeam = isTopHalf ? awayTeam : homeTeam;
  const pitchingTeam = isTopHalf ? homeTeam : awayTeam;
  const pitchCount = isTopHalf ? activeSession.homePitching.pitchCount : activeSession.awayPitching.pitchCount;

  return (
    <section className="space-y-5">
      {/*
        The park dialog, mounted unconditionally and opened by state.

        Deliberately outside the sections below rather than inside the rosters block: a Modal already
        portals itself to document.body, and placing it inside a conditional subtree would mean it
        mounts and unmounts with whatever it sits in — which is how a dialog ends up inheriting a
        parent's key and remounting itself on every unrelated state change.
      */}
      <ParkPanel
        isOpen={isParkOpen}
        onClose={() => setIsParkOpen(false)}
        team={homeTeam}
      />

      <RetroButton variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Schedule
      </RetroButton>

      {blockingGames.length > 0 && game.status === 'scheduled' && (
        <Panel className="border-l-[3px] border-l-[var(--color-warn)] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="t-h3">Earlier Games Need Resolution</h2>
              <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
                This game is not the earliest unresolved game on {game.date}. Resolve the earlier
                slate first to preserve day order.
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {blockingGames.map((blockingGame) => (
                  <span
                    key={blockingGame.gameId}
                    className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-2 py-1 t-stat-sm"
                  >
                    {blockingGame.awayTeam.toUpperCase()} @ {blockingGame.homeTeam.toUpperCase()}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <RetroButton variant="primary" size="sm" onClick={onSimulateBlockingGames}>
                  <FastForward className="h-4 w-4" aria-hidden="true" /> Sim Earlier Games First
                </RetroButton>
                <RetroButton variant="ghost" size="sm" onClick={onBack}>Back</RetroButton>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {noParticipants && (
        <Panel className="border-l-[3px] border-l-[var(--color-warn)] p-4">
          <p className="t-h3">Player Snapshot Missing</p>
          <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
            Generate or assign rostered players before using the interactive player-driven game screen.
          </p>
        </Panel>
      )}

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_260px]">
        <SidePanel
          role="BATTING SIDE"
          team={battingTeam}
          runs={isTopHalf ? displayAwayRuns : displayHomeRuns}
          hits={isTopHalf ? displayAwayHits : displayHomeHits}
          errors={isTopHalf ? displayAwayErrors : displayHomeErrors}
        />

        <Panel variant="hero" className="flex flex-col gap-4 p-4">
          <GameClock
            date={`${awayTeam.city} at ${homeTeam.city} · ${game.date}`}
            scheduledTime={scheduledTimeLabel}
            simTime={currentSimTimeLabel}
            windowLabel={gameWindowLabel}
            statusLabel={statusLabel}
            isBroadcasting={isBroadcasting}
          />

          {activeSession.participants && (
            <MatchupCard batter={currentBatter} pitcher={currentPitcher} pitchCount={pitchCount} />
          )}

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
            <LineScore
              awayTeam={awayTeam}
              homeTeam={homeTeam}
              lineScore={lineScore}
              away={{ runs: displayAwayRuns, hits: displayAwayHits, errors: displayAwayErrors }}
              home={{ runs: displayHomeRuns, hits: displayHomeHits, errors: displayHomeErrors }}
              half={displaySession.half}
              outs={displaySession.outs}
            />
            <BaseDiamond
              first={Boolean(displaySession.bases.first)}
              second={Boolean(displaySession.bases.second)}
              third={Boolean(displaySession.bases.third)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <CountTile label="First Base" accent><span className="t-stat-sm">{runnerLabels.first}</span></CountTile>
            <CountTile label="Second Base" accent><span className="t-stat-sm">{runnerLabels.second}</span></CountTile>
            <CountTile label="Third Base" accent><span className="t-stat-sm">{runnerLabels.third}</span></CountTile>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <CountTile label="Away"><span className="t-stat-lg">{displayAwayRuns}</span></CountTile>
            <CountTile label="Home"><span className="t-stat-lg">{displayHomeRuns}</span></CountTile>
            <CountTile label="Outs"><span className="t-stat-lg">{displaySession.outs}</span></CountTile>
            <CountTile label="Active Half"><span className="t-stat-lg">{isTopHalf ? 'Top' : 'Bot'}</span></CountTile>
          </div>

          {/*
            THE PARK, above the lineups rather than beside them.

            It belongs here because of what it is: the park is a property of the GROUND this game is
            being played on, and the lineups are the two clubs about to play on it. Putting the button
            immediately above the lineups keeps the reading order right -- where we are, who is here,
            then what the park is doing to both of them.

            It says HOME PARK and not PARK because that is a real distinction and the alternative is
            ambiguous. Only the home club's park is in play; `gameEngine` reads
            `parkFactorsForTeam(homeTeam.id)` and nothing else, so a button labelled just "Park" would
            invite the reader to assume the away club's park was being shown, or to wonder which of the
            two they were looking at.
          */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="t-caption text-[var(--color-ink-faint)]">
              The walls, the air and the grass on this ground — and what they do to the numbers above.
            </p>
            <RetroButton variant="ghost" size="sm" onClick={() => setIsParkOpen(true)}>
              <MapPinned className="h-4 w-4" aria-hidden="true" /> {homeTeam.city} Park
            </RetroButton>
          </div>

          {activeSession.participants && (
            <div className="grid gap-3 lg:grid-cols-2">
              <LineupList
                title="AWAY LINEUP"
                entries={activeSession.participants.awayLineup}
                activePlayerId={isTopHalf ? currentBatter?.playerId ?? null : null}
              />
              <LineupList
                title="HOME LINEUP"
                entries={activeSession.participants.homeLineup}
                activePlayerId={isTopHalf ? null : currentBatter?.playerId ?? null}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {session.status === 'pregame' && blockingGames.length === 0 && game.status !== 'completed' && (
              <RetroButton variant="primary" onClick={handleStart} disabled={noParticipants}>
                <Play className="h-4 w-4" aria-hidden="true" /> Start Game
              </RetroButton>
            )}
            {session.status === 'in_progress' && (
              <>
                <RetroButton variant="primary" onClick={handleNextAtBat} disabled={isBroadcasting || noParticipants}>
                  <Play className="h-4 w-4" aria-hidden="true" /> Next At-Bat
                </RetroButton>
                <RetroButton variant="default" onClick={handleNextHalf} disabled={isBroadcasting || noParticipants}>
                  <SkipForward className="h-4 w-4" aria-hidden="true" /> Next Half Inning
                </RetroButton>
                <RetroButton variant="default" onClick={handleSimToFinal} disabled={isBroadcasting || noParticipants}>
                  <FastForward className="h-4 w-4" aria-hidden="true" /> Sim To Final
                </RetroButton>
              </>
            )}
            {session.status === 'completed' && (
              <p className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 t-caption text-[var(--color-ink-dim)]">
                {isBroadcasting
                  ? `Broadcast finishing. ${visibleLogs.length}/${logs.length} plays on screen.`
                  : `Game complete. Final score ${displayAwayRuns}-${displayHomeRuns}.`}
              </p>
            )}
          </div>
        </Panel>

        <SidePanel
          role="PITCHING SIDE"
          team={pitchingTeam}
          runs={isTopHalf ? displayHomeRuns : displayAwayRuns}
          hits={isTopHalf ? displayHomeHits : displayAwayHits}
          errors={isTopHalf ? displayHomeErrors : displayAwayErrors}
        />
      </div>

      <PlayLog
        logs={visibleLogs}
        totalLogs={logs.length}
        isBroadcasting={isBroadcasting}
        viewportRef={logViewportRef}
        onSkip={handleSkipBroadcast}
      />
    </section>
  );
};
