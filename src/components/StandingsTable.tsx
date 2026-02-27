import React from 'react';
import { Team } from '../types';
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react';

interface StandingsTableProps {
  divisionName: string;
  teams: Team[];
  headerColor?: string;
}

export const StandingsTable: React.FC<StandingsTableProps> = ({ divisionName, teams, headerColor = 'text-slate-200' }) => {
  // Sort by Win PCT, then Wins
  const sortedTeams = [...teams].sort((a, b) => {
    const pctA = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0;
    const pctB = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0;
    if (pctB !== pctA) return pctB - pctA;
    return b.wins - a.wins;
  });

  const leader = sortedTeams[0];

  return (
    <div className="bg-[#323232] rounded-lg border border-white/10 overflow-hidden shadow-lg">
      <div className="bg-black/20 px-4 py-2 border-b border-white/10 flex justify-between items-center">
        <h3 className={`font-display text-lg tracking-wide uppercase ${headerColor}`}>{divisionName}</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-black/40 text-slate-400 font-mono text-xs uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Team</th>
            <th className="px-2 py-2 text-center font-medium w-12">W</th>
            <th className="px-2 py-2 text-center font-medium w-12">L</th>
            <th className="px-2 py-2 text-center font-medium w-16">PCT</th>
            <th className="px-2 py-2 text-center font-medium w-12">GB</th>
            <th className="px-2 py-2 text-center font-medium w-12">DIFF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sortedTeams.map((team, index) => {
            const gamesPlayed = team.wins + team.losses;
            const pct = gamesPlayed > 0 ? (team.wins / gamesPlayed).toFixed(3).substring(1) : '.000';
            const diff = team.runsScored - team.runsAllowed;
            
            // GB Calculation
            const leaderGames = leader.wins + leader.losses;
            const teamGames = team.wins + team.losses;
            const gb = index === 0 ? '-' : (
              ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2
            ).toFixed(1);

            return (
              <tr key={team.id} className="hover:bg-white/5 transition-colors group">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {index === 0 && gamesPlayed > 0 && (
                      <div className={`w-1 h-full absolute left-0 ${headerColor.replace('text-', 'bg-')}/50`} />
                    )}
                    <div className="flex flex-col">
                      <span className="font-display font-bold text-white text-base leading-none tracking-wide">
                        {team.city}
                      </span>
                      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                        {team.name}
                      </span>
                    </div>
                    {index === 0 && gamesPlayed > 10 && (
                      <Trophy className={`w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity ${headerColor}`} />
                    )}
                  </div>
                </td>
                <td className="px-2 py-2 text-center font-mono text-slate-200">{team.wins}</td>
                <td className="px-2 py-2 text-center font-mono text-slate-400">{team.losses}</td>
                <td className="px-2 py-2 text-center font-mono text-slate-300">{pct}</td>
                <td className="px-2 py-2 text-center font-mono text-slate-500 text-xs">{gb}</td>
                <td className={`px-2 py-2 text-center font-mono text-xs font-bold ${diff > 0 ? 'text-emerald-400' : diff < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                  {diff > 0 ? '+' : ''}{diff}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
