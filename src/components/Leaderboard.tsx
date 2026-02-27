import React from 'react';
import { Team } from '../types';

interface LeaderboardProps {
  teams: Team[];
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ teams }) => {
  const sortedByWins = [...teams].sort((a, b) => b.wins - a.wins).slice(0, 10);
  const sortedByDiff = [...teams].sort((a, b) => (b.runsScored - b.runsAllowed) - (a.runsScored - a.runsAllowed)).slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Best Record */}
      <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
        <h3 className="font-display text-sm tracking-widest text-slate-400 uppercase mb-3 border-b border-slate-700 pb-2">
          League Leaders (Wins)
        </h3>
        <ul className="space-y-2">
          {sortedByWins.map((team, i) => (
            <li key={team.id} className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-3">
                <span className="font-mono text-slate-500 w-4">{i + 1}</span>
                <span className="font-bold text-slate-200">{team.city} {team.name}</span>
              </div>
              <span className="font-mono text-emerald-400 font-bold">{team.wins}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Best Run Diff */}
      <div className="bg-slate-800/50 rounded-lg border border-slate-700 p-4">
        <h3 className="font-display text-sm tracking-widest text-slate-400 uppercase mb-3 border-b border-slate-700 pb-2">
          Run Differential
        </h3>
        <ul className="space-y-2">
          {sortedByDiff.map((team, i) => {
            const diff = team.runsScored - team.runsAllowed;
            return (
              <li key={team.id} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-slate-500 w-4">{i + 1}</span>
                  <span className="font-bold text-slate-200">{team.city} {team.name}</span>
                </div>
                <span className={`font-mono font-bold ${diff > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
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
