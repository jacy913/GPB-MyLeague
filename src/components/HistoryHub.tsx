import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import {
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryEntry,
  Team,
} from '../types';
import { Panel, RetroButton, TeamLogo } from './ui';
import mvpBeltImage from '../assets/mvpbelt.png';
import trophyImage from '../assets/trophy.png';
import worldSeriesMvpImage from '../assets/worldseriesmvp.png';

interface HistoryHubProps {
  seasonHistory: SeasonHistoryEntry[];
  teams: Team[];
}

const formatCompletedAt = (isoValue: string): string => {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return 'Archived';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const buildFallbackTeam = (
  teamId: string,
  teamCity: string,
  teamName: string,
): Team => ({
  id: teamId,
  city: teamCity,
  name: teamName,
  league: 'Platinum',
  division: 'North',
  rating: 0,
  previousBaselineWins: 0,
  wins: 0,
  losses: 0,
  runsScored: 0,
  runsAllowed: 0,
});

const resolveTeamFromWinner = (
  winner: {
    teamId: string | null;
    teamCity: string | null;
    teamName: string | null;
  } | null,
  teamsById: Map<string, Team>,
): Team | null => {
  if (!winner?.teamId) {
    return null;
  }
  const liveTeam = teamsById.get(winner.teamId);
  if (liveTeam) {
    return liveTeam;
  }
  if (!winner.teamCity || !winner.teamName) {
    return null;
  }
  return buildFallbackTeam(winner.teamId, winner.teamCity, winner.teamName);
};

/**
 * Award tile.
 *
 * Structure, crest sizes and image sizes are unchanged from the pre-migration
 * version -- only the surface is retokenised. The award artwork is the one place
 * in the product that keeps a soft drop shadow, because these are photographs of
 * physical objects rather than UI chrome, and a hard cut would look pasted on.
 */
const AwardTile: React.FC<{
  title: string;
  subtitle: string;
  winner: SeasonHistoryAwardWinner | null;
  winnerTeam: Team | null;
  imageSrc: string;
  imageAlt: string;
}> = ({ title, subtitle, winner, winnerTeam, imageSrc, imageAlt }) => (
  <Panel className="flex flex-col p-4 md:p-5">
    <div className="flex items-start justify-between gap-5">
      <div>
        <p className="t-caption text-[var(--color-ink-faint)]">{subtitle}</p>
        <p className="t-h3 mt-1">{title}</p>
      </div>
      <img src={imageSrc} alt={imageAlt} className="h-28 w-auto object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.42)] md:h-32" />
    </div>
    {winner ? (
      <Panel variant="sunken" className="mt-4 flex items-center gap-4 p-3">
        {winnerTeam
          ? <TeamLogo team={winnerTeam} sizeClass="h-24 w-24" />
          : <span className="h-24 w-24 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="t-h2 truncate">{winner.playerName}</p>
          <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
            {winner.teamCity && winner.teamName ? `${winner.teamCity} ${winner.teamName}` : 'No Team'}
          </p>
          <p className="t-caption mt-2 text-[var(--color-platinum)]">{winner.summary}</p>
        </div>
      </Panel>
    ) : (
      <p className="t-caption mt-4 text-[var(--color-ink-faint)]">Not available</p>
    )}
  </Panel>
);

const DivisionWinnerTile: React.FC<{ winner: SeasonHistoryDivisionWinner; winnerTeam: Team | null }> = ({ winner, winnerTeam }) => (
  <Panel variant="sunken" className="p-3">
    <p className="t-caption text-[var(--color-ink-faint)]">{winner.league} {winner.division}</p>
    <div className="mt-2 flex items-center gap-3">
      {winnerTeam
        ? <TeamLogo team={winnerTeam} sizeClass="h-20 w-20" />
        : <span className="h-20 w-20 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="t-h2 truncate">{winner.teamCity}</p>
        <p className="t-caption truncate text-[var(--color-ink-dim)]">{winner.teamName}</p>
        <p className="t-caption mt-1 text-[var(--color-platinum)]">{winner.wins}-{winner.losses}</p>
      </div>
    </div>
  </Panel>
);

export const HistoryHub: React.FC<HistoryHubProps> = ({ seasonHistory, teams }) => {
  const teamsById = useMemo(() => new Map<string, Team>(teams.map((team) => [team.id, team] as const)), [teams]);
  const orderedHistory = useMemo(
    () => [...seasonHistory].sort((left, right) => right.seasonYear - left.seasonYear),
    [seasonHistory],
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (orderedHistory.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, orderedHistory.length - 1));
  }, [orderedHistory.length]);

  if (orderedHistory.length === 0) {
    return (
      <Panel variant="hero" className="p-6 md:p-8">
        <h1 className="t-h1">No Seasons Archived</h1>
        <p className="t-body mt-3 max-w-2xl text-[var(--color-ink-dim)]">
          Complete a full season and this page will automatically save champions, division winners, and MVP awards.
        </p>
      </Panel>
    );
  }

  const entry = orderedHistory[activeIndex];
  const champion = entry.champion;
  const championTeam = champion
    ? (teamsById.get(champion.teamId) ?? buildFallbackTeam(champion.teamId, champion.teamCity, champion.teamName))
    : null;
  const battingMvpTeam = resolveTeamFromWinner(entry.battingMvp, teamsById);
  const pitchingMvpTeam = resolveTeamFromWinner(entry.pitchingMvp, teamsById);
  const worldSeriesMvpTeam = resolveTeamFromWinner(entry.worldSeriesMvp, teamsById);

  return (
    <section className="space-y-4">
      <Panel variant="hero" className="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5">
        <div>
          <h1 className="t-h1">Season {entry.seasonYear}</h1>
          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">Saved {formatCompletedAt(entry.completedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <RetroButton
            variant="ghost"
            size="sm"
            onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}
            disabled={activeIndex === 0}
            aria-label="Previous season snapshot"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </RetroButton>
          <span className="t-stat-sm tabular-nums text-[var(--color-ink-dim)]">
            {activeIndex + 1} / {orderedHistory.length}
          </span>
          <RetroButton
            variant="ghost"
            size="sm"
            onClick={() => setActiveIndex((current) => Math.min(orderedHistory.length - 1, current + 1))}
            disabled={activeIndex >= orderedHistory.length - 1}
            aria-label="Next season snapshot"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </RetroButton>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* The champion panel keeps its warmer surface. It is the one card on
            this screen that is about a specific achievement rather than a list,
            and a gold edge is the only place the league accent reads as
            celebration rather than as an active state. */}
        <article className="relative min-h-[420px] overflow-hidden border border-[var(--color-gold-dim)] bg-[var(--color-panel)] p-4 md:min-h-[520px] md:p-5">
          <p className="t-caption text-[var(--color-gold)]">Champion</p>
          <h2 className="t-h2 mt-1">World Series Winner</h2>
          <img
            src={trophyImage}
            alt="Championship trophy"
            className="pointer-events-none absolute bottom-0 right-2 h-[300px] w-auto object-contain drop-shadow-[0_24px_44px_rgba(0,0,0,0.55)] md:right-4 md:h-[430px]"
          />
          {champion && championTeam ? (
            <div className="relative z-10 mt-5 max-w-[62%]">
              <TeamLogo team={championTeam} sizeClass="h-32 w-32 md:h-40 md:w-40" />
              <p className="t-h1 mt-3">{champion.teamCity}</p>
              <p className="t-h2 text-[var(--color-gold-hi)]">{champion.teamName}</p>
              <p className="t-caption mt-2">
                Regular Season {champion.wins}-{champion.losses}
              </p>
            </div>
          ) : (
            <p className="relative z-10 mt-4 t-caption text-[var(--color-ink-faint)]">Champion unavailable</p>
          )}
        </article>

        <Panel className="p-4 md:p-5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-[var(--color-platinum)]" aria-hidden="true" />
            <h2 className="t-label">Division Winners</h2>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {entry.divisionWinners.map((winner) => (
              <DivisionWinnerTile
                key={`${entry.seasonYear}-${winner.league}-${winner.division}-${winner.teamId}`}
                winner={winner}
                winnerTeam={teamsById.get(winner.teamId) ?? buildFallbackTeam(winner.teamId, winner.teamCity, winner.teamName)}
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AwardTile
          title="Batting MVP"
          subtitle="Regular Season"
          winner={entry.battingMvp}
          winnerTeam={battingMvpTeam}
          imageSrc={mvpBeltImage}
          imageAlt="MVP belt"
        />
        <AwardTile
          title="Pitching MVP"
          subtitle="Regular Season"
          winner={entry.pitchingMvp}
          winnerTeam={pitchingMvpTeam}
          imageSrc={mvpBeltImage}
          imageAlt="MVP belt"
        />
        <AwardTile
          title="World Series MVP"
          subtitle="Playoffs"
          winner={entry.worldSeriesMvp}
          winnerTeam={worldSeriesMvpTeam}
          imageSrc={worldSeriesMvpImage}
          imageAlt="World Series MVP award"
        />
      </div>
    </section>
  );
};
