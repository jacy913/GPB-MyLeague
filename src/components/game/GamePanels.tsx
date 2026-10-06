import React from 'react';
import { Clock3, FastForward } from 'lucide-react';
import type { GameParticipantBatter, GameParticipantPitcher, PlayLogEvent } from '../../types';
import { fmtAvg, fmtEra, fmtWhip } from '../../logic/statFormatting';
import { Panel, RetroButton } from '../ui';
import { CountTile } from './shared';

export const PlayLog: React.FC<{
  logs: PlayLogEvent[];
  totalLogs: number;
  isBroadcasting: boolean;
  viewportRef: React.RefObject<HTMLOListElement | null>;
  onSkip: () => void;
}> = ({ logs, totalLogs, isBroadcasting, viewportRef, onSkip }) => (
  <Panel className="mx-auto max-w-5xl overflow-hidden">
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
      <div>
        <h2 className="t-label">Play Log</h2>
        <p className="t-caption text-[var(--color-ink-faint)]">{logs.length}/{totalLogs} events shown</p>
      </div>
      {isBroadcasting && (
        <RetroButton variant="default" size="sm" onClick={onSkip}>
          <FastForward className="h-4 w-4" aria-hidden="true" /> Skip Broadcast
        </RetroButton>
      )}
    </div>

    <ol
      ref={viewportRef}
      className="max-h-[420px] overflow-y-auto"
      aria-live="polite"
      aria-label="Play by play"
    >
      {logs.length === 0 ? (
        <li className="p-4 t-caption text-[var(--color-ink-faint)]">No play log available yet.</li>
      ) : (
        logs.map((log) => (
          <li
            key={log.seq}
            className="flex items-start gap-3 border-b border-[var(--color-chrome-lo)] px-4 py-2 last:border-b-0"
          >
            <span className="w-[6ch] shrink-0 t-caption text-[var(--color-ink-faint)]">
              {log.half === 'top' ? 'TOP' : 'BOT'} {log.inning}
            </span>
            <span className="w-[7ch] shrink-0 t-stat-sm text-[var(--color-ink-dim)]">
              {log.scoreAway}-{log.scoreHome}
            </span>
            <span className="min-w-0 flex-1 t-body text-[var(--color-ink-dim)]">{log.description}</span>
          </li>
        ))
      )}
    </ol>
  </Panel>
);

export const MatchupCard: React.FC<{
  batter: GameParticipantBatter | null;
  pitcher: GameParticipantPitcher | null;
  pitchCount: number;
}> = ({ batter, pitcher, pitchCount }) => (
  <div className="grid gap-2 lg:grid-cols-2">
    <Panel variant="sunken" className="p-3">
      <p className="t-caption text-[var(--color-ink-faint)]">CURRENT BATTER</p>
      <p className="t-h2 mt-1 truncate">{batter?.fullName ?? '---'}</p>
      <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
        {batter ? `${batter.primaryPosition} · Bats ${batter.bats}` : 'Awaiting matchup'}
      </p>
      <p className="t-caption mt-0.5 text-[var(--color-ink-faint)]">
        {batter
          ? `CON ${batter.battingRatings.contact} · PWR ${batter.battingRatings.power}`
          : 'No attributes loaded'}
      </p>
      <p className="t-caption mt-0.5 text-[var(--color-ink-faint)]">
        {batter?.battingStat
          ? `${fmtAvg(batter.battingStat.avg)} AVG · ${batter.battingStat.atBats} AB · ${batter.battingStat.homeRuns} HR`
          : 'No season batting line loaded'}
      </p>
    </Panel>

    <Panel variant="sunken" className="p-3">
      <p className="t-caption text-[var(--color-ink-faint)]">CURRENT PITCHER</p>
      <p className="t-h2 mt-1 truncate">{pitcher?.fullName ?? '---'}</p>
      <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
        {pitcher ? `${pitcher.role} · Throws ${pitcher.throws}` : 'Awaiting matchup'}
      </p>
      <p className="t-caption mt-0.5 text-[var(--color-ink-faint)]">
        {pitcher
          ? `STF ${pitcher.pitchingRatings.stuff} · CMD ${pitcher.pitchingRatings.command} · ${pitchCount} PC`
          : 'No attributes loaded'}
      </p>
      <p className="t-caption mt-0.5 text-[var(--color-ink-faint)]">
        {pitcher?.pitchingStat
          ? `${fmtEra(pitcher.pitchingStat.era)} ERA · ${fmtWhip(pitcher.pitchingStat.whip)} WHIP · ${pitcher.pitchingStat.strikeouts} K`
          : 'No season pitching line loaded'}
      </p>
    </Panel>
  </div>
);

export const LineupList: React.FC<{
  title: string;
  entries: Array<{ playerId: string; fullName: string; primaryPosition: string }>;
  activePlayerId: string | null;
  /**
   * What each player actually did, once the game is over.
   *
   * Absent while the game is live, and the list is then a batting order and nothing else -- which is
   * correct, because a number for an inning that has not been played is a fabrication.
   */
  gameLines?: Map<string, string>;
}> = ({ title, entries, activePlayerId, gameLines }) => (
  <Panel variant="sunken" className="p-3">
    <p className="t-caption text-[var(--color-ink-faint)]">{title}</p>
    <ol className="mt-2 flex flex-col">
      {entries.map((participant, index) => {
        const active = participant.playerId === activePlayerId;
        const line = gameLines?.get(participant.playerId);
        return (
          <li
            key={participant.playerId}
            aria-current={active ? 'true' : undefined}
            className={`flex flex-wrap items-center justify-between gap-x-2 border-l-[3px] px-2 py-1 ${
              active ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]' : 'border-l-transparent'
            }`}
          >
            <span className={`truncate t-stat-sm ${active ? 'text-[var(--color-gold-hi)]' : ''}`}>
              {index + 1}. {participant.fullName}
            </span>
            <span className="t-caption text-[var(--color-ink-faint)]">{participant.primaryPosition}</span>
            {/*
              THE GAME, UNDER THE NAME.

              The batting order was a list of who is coming up, and stayed a list of who is coming up
              after the game finished -- which is the one screen where "what did he do" is the only
              question left. This is the box score line the manager wants, per player, in the place
              they already read the order.

              A PLAYER WHO DID NOT APPEAR HAS NO ROW AT ALL, rather than a row of zeroes. A bench
              player did not go 0 for 4; they did not bat, and printing the former would put nine
              zeroes on screen for a game where six men played. That distinction is why this is a
              lookup on the reconstructed lines rather than a default.
            */}
            {line && (
              <span className="w-full tabular-nums t-caption text-[var(--color-ink-dim)]">{line}</span>
            )}
          </li>
        );
      })}
    </ol>
  </Panel>
);

export const GameClock: React.FC<{
  date: string;
  scheduledTime: string;
  simTime: string;
  windowLabel: string;
  statusLabel: string;
  isBroadcasting: boolean;
}> = ({ date, scheduledTime, simTime, windowLabel, statusLabel, isBroadcasting }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="t-caption text-[var(--color-ink-faint)]">{date}</p>
      <h1 className="t-h1 mt-1">{statusLabel}</h1>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <CountTile label="FIRST PITCH">
          <span className="flex items-center gap-1.5 t-stat-sm">
            <Clock3 className="h-3.5 w-3.5 text-[var(--color-gold)]" aria-hidden="true" />
            {scheduledTime}
          </span>
        </CountTile>
        <CountTile label="SIM CLOCK"><span className="t-stat-sm">{simTime}</span></CountTile>
        <CountTile label="WINDOW"><span className="t-stat-sm">{windowLabel}</span></CountTile>
      </div>
    </div>
    <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-4 py-3 text-right">
      <p className="t-caption text-[var(--color-ink-faint)]">STATUS</p>
      <p className="t-h3 mt-1">{statusLabel}</p>
      {isBroadcasting && <p className="t-caption mt-1 text-[var(--color-info)]">Broadcast feed live</p>}
    </div>
  </div>
);
