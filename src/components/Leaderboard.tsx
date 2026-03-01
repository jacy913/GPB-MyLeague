import React from 'react';
import { Team } from '../types';
import { TeamLogo } from './TeamLogo';

interface LeaderboardProps {
  teams: Team[];
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ teams }) => {
  const sortedByWins = [...teams].sort((a, b) => b.wins - a.wins).slice(0, 10);
  const sortedByDiff = [...teams].sort((a, b) => (b.runsScored - b.runsAllowed) - (a.runsScored - a.runsAllowed)).slice(0, 10);
  const leagueAccentClass = (league: Team['league']) => (league === 'Prestige' ? 'text-prestige' : 'text-platinum');
  const leagueBorderClass = (league: Team['league']) => (league === 'Prestige' ? 'border-prestige/40' : 'border-platinum/40');

  return (
    <div className="space-y-5">
      <section className="bg-gradient-to-br from-[#1f1f1f] via-[#272727] to-[#1f1f1f] rounded-2xl border border-white/10 p-4 shadow-xl shadow-black/35">
        <h3 className="font-display text-sm tracking-widest text-zinc-200 uppercase mb-3 border-b border-white/10 pb-2">
          League Leaders (Wins)
        </h3>
        <ul className="space-y-2">
          {sortedByWins.map((team, i) => (
            <li key={team.id} className={`rounded-xl border bg-black/25 px-2.5 py-2 transition-colors hover:bg-black/35 ${leagueBorderClass(team.league)}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="font-mono text-zinc-500 text-xs w-5 text-center">{i + 1}</span>
                  <TeamLogo team={team} sizeClass="w-10 h-10" />
                  <div className="min-w-0">
                    <p className={`font-display text-sm leading-none uppercase tracking-wide truncate ${leagueAccentClass(team.league)}`}>
                      {team.city}
                    </p>
                    <p className="font-display text-xs leading-none uppercase tracking-wide text-zinc-400 mt-1 truncate">
                      {team.name}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-mono text-xl leading-none ${leagueAccentClass(team.league)}`}>{team.wins}</p>
                  <p className="font-mono text-[10px] uppercase text-zinc-500 mt-1">{team.wins}-{team.losses}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-gradient-to-br from-[#1f1f1f] via-[#272727] to-[#1f1f1f] rounded-2xl border border-white/10 p-4 shadow-xl shadow-black/35">
        <h3 className="font-display text-sm tracking-widest text-zinc-200 uppercase mb-3 border-b border-white/10 pb-2">
          Run Differential
        </h3>
        <ul className="space-y-2">
          {sortedByDiff.map((team, i) => {
            const diff = team.runsScored - team.runsAllowed;
            return (
              <li key={team.id} className={`rounded-xl border bg-black/25 px-2.5 py-2 transition-colors hover:bg-black/35 ${leagueBorderClass(team.league)}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-zinc-500 text-xs w-5 text-center">{i + 1}</span>
                    <TeamLogo team={team} sizeClass="w-10 h-10" />
                    <div className="min-w-0">
                      <p className={`font-display text-sm leading-none uppercase tracking-wide truncate ${leagueAccentClass(team.league)}`}>
                        {team.city}
                      </p>
                      <p className="font-display text-xs leading-none uppercase tracking-wide text-zinc-400 mt-1 truncate">
                        {team.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono text-xl leading-none ${diff >= 0 ? leagueAccentClass(team.league) : 'text-zinc-400'}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </p>
                    <p className="font-mono text-[10px] uppercase text-zinc-500 mt-1">
                      {team.runsScored}-{team.runsAllowed}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
};
