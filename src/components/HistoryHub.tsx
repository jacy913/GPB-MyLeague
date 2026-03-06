import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import {
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryEntry,
  Team,
} from '../types';
import { TeamLogo } from './TeamLogo';
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

const AwardTile: React.FC<{
  title: string;
  subtitle: string;
  winner: SeasonHistoryAwardWinner | null;
  winnerTeam: Team | null;
  imageSrc: string;
  imageAlt: string;
}> = ({ title, subtitle, winner, winnerTeam, imageSrc, imageAlt }) => (
  <article className="rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
    <div className="flex items-start justify-between gap-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{subtitle}</p>
        <p className="mt-1 font-headline text-2xl uppercase tracking-[0.08em] text-white">{title}</p>
      </div>
      <img src={imageSrc} alt={imageAlt} className="h-28 w-auto object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.42)] md:h-32" />
    </div>
    {winner ? (
      <div className="mt-4 flex items-center gap-4 rounded-xl border border-white/10 bg-black/25 p-3">
        {winnerTeam ? <TeamLogo team={winnerTeam} sizeClass="h-24 w-24" /> : <div className="h-24 w-24 rounded-xl border border-white/10 bg-black/25" />}
        <div className="min-w-0">
          <p className="font-display text-2xl uppercase tracking-[0.06em] text-white">{winner.playerName}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
            {winner.teamCity && winner.teamName ? `${winner.teamCity} ${winner.teamName}` : 'No Team'}
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-platinum">{winner.summary}</p>
        </div>
      </div>
    ) : (
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Not available</p>
    )}
  </article>
);

const DivisionWinnerTile: React.FC<{ winner: SeasonHistoryDivisionWinner; winnerTeam: Team | null }> = ({ winner, winnerTeam }) => (
  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-3">
    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{winner.league} {winner.division}</p>
    <div className="mt-2 flex items-center gap-3">
      {winnerTeam ? <TeamLogo team={winnerTeam} sizeClass="h-20 w-20" /> : <div className="h-20 w-20 rounded-xl border border-white/10 bg-black/25" />}
      <div className="min-w-0">
        <p className="font-display text-2xl uppercase tracking-[0.06em] text-white truncate">{winner.teamCity}</p>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 truncate">{winner.teamName}</p>
        <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-platinum">{winner.wins}-{winner.losses}</p>
      </div>
    </div>
  </div>
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
      <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#202020,#111111)] p-6 md:p-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">History</p>
        <p className="mt-2 font-headline text-4xl uppercase tracking-[0.08em] text-white">No seasons archived</p>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Complete a full season and this page will automatically save champions, division winners, and MVP awards.
        </p>
      </section>
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
    <section className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#202020,#111111)] p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Season {entry.seasonYear}</p>
          <p className="mt-1 font-headline text-4xl uppercase tracking-[0.08em] text-white">Snapshot</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">Saved {formatCompletedAt(entry.completedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}
            disabled={activeIndex === 0}
            className="rounded-xl border border-white/10 bg-black/25 p-2 text-zinc-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous season snapshot"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
            {activeIndex + 1} / {orderedHistory.length}
          </div>
          <button
            type="button"
            onClick={() => setActiveIndex((current) => Math.min(orderedHistory.length - 1, current + 1))}
            disabled={activeIndex >= orderedHistory.length - 1}
            className="rounded-xl border border-white/10 bg-black/25 p-2 text-zinc-300 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next season snapshot"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <article className="relative overflow-hidden rounded-2xl border border-[#d4bb6a]/25 bg-[linear-gradient(140deg,rgba(212,187,106,0.16),rgba(255,255,255,0.02),rgba(0,0,0,0.15))] p-4 md:p-5 min-h-[420px] md:min-h-[520px]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d8c88b]">Champion</p>
              <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">World Series Winner</p>
            </div>
          </div>
          <img
            src={trophyImage}
            alt="Championship trophy"
            className="pointer-events-none absolute right-2 bottom-0 h-[300px] w-auto object-contain drop-shadow-[0_24px_44px_rgba(0,0,0,0.55)] md:right-4 md:h-[430px]"
          />
          {champion && championTeam ? (
            <div className="relative z-10 mt-5 max-w-[62%]">
              <TeamLogo team={championTeam} sizeClass="h-32 w-32 md:h-40 md:w-40" />
              <p className="mt-3 font-display text-4xl uppercase tracking-[0.06em] text-white">{champion.teamCity}</p>
              <p className="font-headline text-3xl uppercase tracking-[0.08em] text-[#ecd693]">{champion.teamName}</p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                Regular Season {champion.wins}-{champion.losses}
              </p>
            </div>
          ) : (
            <p className="relative z-10 mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Champion unavailable</p>
          )}
        </article>

        <article className="rounded-2xl border border-white/10 bg-black/20 p-4 md:p-5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-platinum" />
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Division Winners</p>
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
        </article>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
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
