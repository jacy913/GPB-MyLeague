import React from 'react';
import { BarChart3, CalendarClock, ChevronDown, ChevronUp, Star } from 'lucide-react';
import type { Game, Team } from '../../types';
import { getScheduledGameTimeLabel } from '../../logic/gameTimes';
import { LeagueBadge, Panel, RatingRing, RetroButton, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from '../ui';
import {
  ClubPanel,
  ROSTER_STRENGTH_SLOT_COUNT,
  StatTile,
  describeTeam,
  formatGameLabel,
  getRosterStrengthTier,
  recordOf,
  runDiffOf,
  type TeamRosterEntry,
} from './shared';

/* ---------------- team directory ---------------- */

export const TeamDirectory: React.FC<{
  selectedTeam: Team;
  byLeague: Array<{ league: Team['league']; teams: Team[] }>;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (teamId: string) => void;
}> = ({ selectedTeam, byLeague, isOpen, onToggle, onSelect }) => (
  <Panel className="overflow-hidden">
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <TeamLogo team={selectedTeam} sizeClass="h-9 w-9" />
        <div className="min-w-0">
          <p className="t-caption text-[var(--color-ink-faint)]">TEAM DIRECTORY</p>
          <p className="truncate t-h3">{selectedTeam.city} {selectedTeam.name}</p>
        </div>
      </div>
      <RetroButton variant="default" size="sm" onClick={onToggle} aria-expanded={isOpen}>
        Choose Team
        {isOpen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
      </RetroButton>
    </div>
    {isOpen && (
      <div className="grid max-h-[480px] gap-4 overflow-y-auto p-4 xl:grid-cols-2">
        {byLeague.map(({ league, teams }) => (
          <div key={league}>
            <div className="mb-2">
              <LeagueBadge variant={league === 'Prestige' ? 'prestige' : 'platinum'} size="sm" />
            </div>
            <div className="grid gap-1">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => onSelect(team.id)}
                  aria-pressed={team.id === selectedTeam.id}
                  className={`flex w-full items-center gap-3 border-l-[3px] px-2 py-2 text-left transition-colors ${
                    team.id === selectedTeam.id
                      ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]'
                      : 'border-l-transparent bg-[var(--color-sunken)] hover:border-l-[var(--color-chrome-hi)]'
                  }`}
                >
                  <TeamLogo team={team} sizeClass="h-8 w-8" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate t-stat-sm">{team.city}</span>
                    <span className="block truncate t-caption text-[var(--color-ink-faint)]">
                      {team.name} · {recordOf(team)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )}
  </Panel>
);

/* ---------------- club hero ---------------- */

export const ClubHero: React.FC<{
  team: Team;
  divisionRank: number;
  leagueRank: number;
  runRank: number;
  hitRank: number;
  teamHits: number;
  rosterStrength: { overall: number | null; filledSlots: number };
}> = ({ team, divisionRank, leagueRank, runRank, hitRank, teamHits, rosterStrength }) => {
  const diff = runDiffOf(team);
  return (
    <Panel variant="hero" className="overflow-hidden">
      <div className="grid gap-4 p-4 xl:grid-cols-[200px_minmax(0,1fr)_260px]">
        <div className="flex flex-col items-center justify-center gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-4 text-center">
          <TeamLogo team={team} sizeClass="h-28 w-28" />
          <p className="t-h2 text-[var(--color-gold-hi)]">{team.city}</p>
          <p className="t-h3 text-[var(--color-ink-dim)]">{team.name}</p>
        </div>

        <div className="min-w-0">
          <p className="t-caption text-[var(--color-ink-faint)]">{team.league} · {team.division}</p>
          <h1 className="t-h1 mt-1">{team.city} {team.name}</h1>
          <p className="t-body mt-2 text-[var(--color-ink-dim)]">{describeTeam(team, divisionRank, leagueRank)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile label="Runs Rank" value={`#${runRank}`} detail={`${team.runsScored} RS`} />
            <StatTile label="Hits Rank" value={`#${hitRank}`} detail={`${teamHits} H`} />
            <StatTile label="Division" value={`#${divisionRank}`} detail={team.division} />
            <StatTile label="League" value={`#${leagueRank}`} detail={team.league} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-3">
            <RatingRing value={rosterStrength.overall} label="AVG" caption={getRosterStrengthTier(rosterStrength.overall)} />
            <div className="min-w-0">
              <p className="t-caption text-[var(--color-ink-faint)]">ROSTER STRENGTH</p>
              <p className="t-stat-sm mt-1">
                {rosterStrength.filledSlots}/{ROSTER_STRENGTH_SLOT_COUNT}
              </p>
              <p className="t-caption mt-0.5 text-[var(--color-ink-faint)]">
                Lineup and rotation, backups excluded
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label="Record" value={recordOf(team)} />
            <StatTile label="Run Diff" value={diff >= 0 ? `+${diff}` : `${diff}`} accent={diff >= 0} />
          </div>
        </div>
      </div>
    </Panel>
  );
};

/* ---------------- depth chart ---------------- */

const depthColumns: StatTableColumn[] = [
  { key: 'slot', header: 'SLOT', align: 'right', isNumeric: true, width: '7ch' },
  { key: 'player', header: 'PLAYER' },
  { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '4ch' },
];

const DepthList: React.FC<{
  title: string;
  eyebrow: string;
  entries: TeamRosterEntry[];
  team: Team;
  selectedPlayerId: string | null;
  onSelectPlayer: (playerId: string) => void;
  emptyTitle: string;
  emptyBody: string;
  aside: string;
}> = ({ title, eyebrow, entries, team, selectedPlayerId, onSelectPlayer, emptyTitle, emptyBody, aside }) => {
  const rows: StatTableRow[] = entries.map((entry) => ({
    id: entry.player.playerId,
    cells: {
      slot: entry.slotCode,
      player: (
        <span className="flex min-w-0 items-center gap-2">
          <TeamLogo team={team} sizeClass="h-5 w-5" />
          <span className="truncate t-stat-sm">{entry.player.firstName} {entry.player.lastName}</span>
        </span>
      ),
      ovr: <StatValue size="sm" variant={entry.overall >= 88 ? 'accent' : 'default'}>{entry.overall || '---'}</StatValue>,
    },
  }));

  return (
    <ClubPanel title={title} eyebrow={eyebrow} aside={<span className="t-caption text-[var(--color-ink-faint)]">{aside}</span>} bodyClassName="p-0">
      {rows.length === 0 ? (
        <p className="p-6 text-center t-body text-[var(--color-ink-dim)]">
          <span className="block t-h3 text-[var(--color-ink)]">{emptyTitle}</span>
          <span className="mt-1 block t-caption">{emptyBody}</span>
        </p>
      ) : (
        <StatTable
          columns={depthColumns}
          rows={rows}
          density="dense"
          onRowSelect={(id) => onSelectPlayer(String(id))}
          selectedRowId={selectedPlayerId}
          aria-label={title}
        />
      )}
    </ClubPanel>
  );
};

export const DepthChart: React.FC<{
  battingOrder: TeamRosterEntry[];
  startingRotation: TeamRosterEntry[];
  team: Team;
  selectedPlayerId: string | null;
  onSelectPlayer: (playerId: string) => void;
}> = ({ battingOrder, startingRotation, team, selectedPlayerId, onSelectPlayer }) => (
  <div className="grid gap-5 xl:grid-cols-2">
    <DepthList
      title="Batting Order"
      eyebrow="Lineup Logic"
      entries={battingOrder}
      team={team}
      selectedPlayerId={selectedPlayerId}
      onSelectPlayer={onSelectPlayer}
      emptyTitle="Lineup Unavailable"
      emptyBody="This team needs all nine batting slots populated to build the order."
      aside={`${battingOrder.length} HITTERS`}
    />
    <DepthList
      title="Starting Rotation"
      eyebrow="Pitching Staff"
      entries={startingRotation}
      team={team}
      selectedPlayerId={selectedPlayerId}
      onSelectPlayer={onSelectPlayer}
      emptyTitle="Rotation Unavailable"
      emptyBody="Populate the five starter slots to show the rotation order."
      aside={`${startingRotation.length} STARTERS`}
    />
  </div>
);

/* ---------------- schedule ---------------- */

export const SchedulePanel: React.FC<{
  team: Team;
  nextGame: Game | null;
  lastFive: Game[];
  teamsById: Map<string, Team>;
  games: Game[];
  onOpenGame: (gameId: string) => void;
}> = ({ team, nextGame, lastFive, teamsById, games, onOpenGame }) => (
  <ClubPanel
    title="Next Game"
    eyebrow="Schedule Outlook"
    aside={<CalendarClock className="h-4 w-4 text-[var(--color-ink-faint)]" aria-hidden="true" />}
  >
    {nextGame ? (
      <button
        type="button"
        onClick={() => onOpenGame(nextGame.gameId)}
        className="flex w-full items-center justify-between gap-3 border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] p-3 text-left transition-colors hover:bg-[var(--color-panel-2)]"
      >
        <div className="min-w-0">
          <p className="t-h3 truncate">{formatGameLabel(nextGame, team.id, teamsById)}</p>
          <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
            {nextGame.date} · {getScheduledGameTimeLabel(nextGame, games)}
          </p>
          {nextGame.playoff && (
            <p className="t-caption text-[var(--color-ink-faint)]">
              {nextGame.playoff.seriesLabel} · Game {nextGame.playoff.gameNumber}
            </p>
          )}
        </div>
      </button>
    ) : (
      <p className="t-body text-[var(--color-ink-dim)]">This team has finished its current slate.</p>
    )}

    <div className="mt-4">
      <p className="t-label mb-2 flex items-center gap-2 text-[var(--color-ink-dim)]">
        <BarChart3 className="h-4 w-4" aria-hidden="true" /> Last 5 Games
      </p>
      {lastFive.length === 0 ? (
        <p className="t-caption text-[var(--color-ink-faint)]">No completed games yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {lastFive.map((game) => {
            const won =
              (game.awayTeam === team.id && game.score.away > game.score.home) ||
              (game.homeTeam === team.id && game.score.home > game.score.away);
            return (
              <button
                key={game.gameId}
                type="button"
                onClick={() => onOpenGame(game.gameId)}
                className="border-l-[3px] border-l-transparent bg-[var(--color-sunken)] px-3 py-2 text-left transition-colors hover:border-l-[var(--color-chrome-hi)]"
              >
                <StatValue size="lg" variant={won ? 'pos' : 'neg'}>{won ? 'W' : 'L'}</StatValue>
                <p className="t-stat-sm mt-1">{game.score.away}-{game.score.home}</p>
                <p className="t-caption mt-0.5 truncate text-[var(--color-ink-faint)]">{game.date}</p>
                <p className="t-caption mt-1 line-clamp-2 text-[var(--color-ink-dim)]">
                  {formatGameLabel(game, team.id, teamsById)}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  </ClubPanel>
);

export const ClubSnapshot: React.FC<{
  team: Team;
  teamHits: number;
  lastFiveRecord: { wins: number; losses: number };
}> = ({ team, teamHits, lastFiveRecord }) => (
  <ClubPanel title="Club Snapshot" eyebrow="Season Totals" aside={<Star className="h-4 w-4 text-[var(--color-ink-faint)]" aria-hidden="true" />}>
    <div className="flex flex-col gap-2">
      <StatTile label="Last 5" value={`${lastFiveRecord.wins}-${lastFiveRecord.losses}`} />
      <StatTile label="Baseline Wins" value={team.previousBaselineWins} />
      <StatTile label="Offense" value={team.runsScored} detail="RUNS" />
      <StatTile label="Contact" value={teamHits} detail="HITS" />
      <StatTile label="Prevention" value={team.runsAllowed} detail="RA" />
    </div>
  </ClubPanel>
);
