import React from 'react';
import { Team } from '../types';

interface LeaderboardProps {
  teams: Team[];
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ teams }) => {
  const sortedByWins = [...teams].sort((a, b) => b.wins - a.wins).slice(0, 10);
  const sortedByDiff = [...teams].sort((a, b) => (b.runsScored - b.runsAllowed) - (a.runsScored - a.runsAllowed)).slice(0, 10);
  const leagueAccentClass = (league: Team['league']) => (league === 'Prestige' ? 'text-prestige' : 'text-platinum');

  return (
    <div className="space-y-6">
      {/* Best Record */}
      <div className="bg-gradient-to-br from-[#202020] to-[#2f2f2f] rounded-xl border border-white/10 p-4 shadow-xl shadow-black/35">
        <h3 className="font-display text-sm tracking-widest text-zinc-300 uppercase mb-3 border-b border-white/10 pb-2">
          League Leaders (Wins)
        </h3>
        <ul className="space-y-2">
          {sortedByWins.map((team, i) => (
            <li key={team.id} className="flex justify-between items-center text-sm rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-3">
                <span className="font-mono text-zinc-400 w-5 text-center">{i + 1}</span>
                <span className={`font-bold ${leagueAccentClass(team.league)}`}>{team.name}</span>
              </div>
              <span className={`font-mono font-bold ${leagueAccentClass(team.league)}`}>{team.wins}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Best Run Diff */}
      <div className="bg-gradient-to-br from-[#202020] to-[#2f2f2f] rounded-xl border border-white/10 p-4 shadow-xl shadow-black/35">
        <h3 className="font-display text-sm tracking-widest text-zinc-300 uppercase mb-3 border-b border-white/10 pb-2">
          Run Differential
        </h3>
        <ul className="space-y-2">
          {sortedByDiff.map((team, i) => {
            const diff = team.runsScored - team.runsAllowed;
            return (
              <li key={team.id} className="flex justify-between items-center text-sm rounded-md px-2 py-1.5 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-zinc-400 w-5 text-center">{i + 1}</span>
                  <span className={`font-bold ${leagueAccentClass(team.league)}`}>{team.name}</span>
                </div>
                <span className={`font-mono font-bold ${diff >= 0 ? leagueAccentClass(team.league) : 'text-zinc-400'}`}>
                  {diff > 0 ? '+' : ''}{diff}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};
