import React from 'react';
import { Team } from '../types';
import { Trophy } from 'lucide-react';
import { TeamLogo } from './TeamLogo';

interface LeagueTableProps {
  leagueName: string;
  teams: Team[];
  headerColor?: string;
}

export const LeagueTable: React.FC<LeagueTableProps> = ({ leagueName, teams, headerColor = 'text-slate-200' }) => {
  const accentTextClass =
    headerColor.includes('prestige') ? 'text-prestige' : headerColor.includes('platinum') ? 'text-platinum' : headerColor;
  const accentBgClass =
    headerColor.includes('prestige') ? 'bg-prestige' : headerColor.includes('platinum') ? 'bg-platinum' : 'bg-white';

  // Sort by Win PCT, then Wins
  const sortedTeams = [...teams].sort((a, b) => {
    const pctA = a.wins + a.losses > 0 ? a.wins / (a.wins + a.losses) : 0;
    const pctB = b.wins + b.losses > 0 ? b.wins / (b.wins + b.losses) : 0;
    if (pctB !== pctA) return pctB - pctA;
    return b.wins - a.wins;
  });

  const leader = sortedTeams[0];

  return (
    <div className="bg-gradient-to-br from-[#222222] to-[#323232] rounded-xl border border-white/10 overflow-hidden shadow-xl shadow-black/35">
      <div className="bg-gradient-to-r from-black/45 to-black/20 px-4 py-3 border-b border-white/10 flex justify-between items-center">
        <h3 className={`font-display text-xl tracking-wide uppercase ${headerColor}`}>{leagueName} Standings</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-black/45 text-zinc-400 font-mono text-xs uppercase tracking-wider">
          <tr>
            <th className="px-3 py-3 text-center font-medium w-12">RK</th>
            <th className="px-3 py-3 text-left font-medium">Team</th>
            <th className="px-3 py-3 text-center font-medium w-12">DIV</th>
            <th className="px-3 py-3 text-center font-medium w-12">W</th>
            <th className="px-3 py-3 text-center font-medium w-12">L</th>
            <th className="px-3 py-3 text-center font-medium w-16">PCT</th>
            <th className="px-3 py-3 text-center font-medium w-12">GB</th>
            <th className="px-3 py-3 text-center font-medium w-12">DIFF</th>
            <th className="px-3 py-3 text-center font-medium w-12">L10</th>
            <th className="px-3 py-3 text-center font-medium w-12">STRK</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {sortedTeams.map((team, index) => {
            const gamesPlayed = team.wins + team.losses;
            const pct = gamesPlayed > 0 ? (team.wins / gamesPlayed).toFixed(3).substring(1) : '.000';
            const diff = team.runsScored - team.runsAllowed;
            
            // GB Calculation
            const gb = index === 0 ? '-' : (
              ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2
            ).toFixed(1);

            return (
              <tr key={team.id} className="hover:bg-white/8 transition-colors group odd:bg-white/[0.02]">
                <td className="px-3 py-2 text-center font-mono text-zinc-500">{index + 1}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-7 rounded-full ${accentBgClass} ${index === 0 ? 'opacity-100' : 'opacity-45'}`} />
                    <TeamLogo team={team} sizeClass="w-8 h-8" />
                    <div className="flex flex-col">
                      <span className={`font-display font-bold text-base leading-none tracking-wide ${accentTextClass}`}>
                        {team.city.toUpperCase()}
                      </span>
                      <span className="text-xs text-zinc-400 font-medium uppercase tracking-wider">
                        {team.name}
                      </span>
                    </div>
                    {index === 0 && gamesPlayed > 10 && (
                      <Trophy className={`w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity ${headerColor}`} />
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-center font-mono text-zinc-400 text-xs">{team.division.substring(0, 1)}</td>
                <td className="px-3 py-2 text-center font-mono text-zinc-100">{team.wins}</td>
                <td className="px-3 py-2 text-center font-mono text-zinc-300">{team.losses}</td>
                <td className="px-3 py-2 text-center font-mono text-zinc-200">{pct}</td>
                <td className="px-3 py-2 text-center font-mono text-zinc-500 text-xs">{gb}</td>
                <td className={`px-3 py-2 text-center font-mono text-xs font-bold ${diff >= 0 ? accentTextClass : 'text-zinc-400'}`}>
                  {diff > 0 ? '+' : ''}{diff}
                </td>
                <td className="px-3 py-2 text-center font-mono text-zinc-500 text-xs">-</td>
                <td className="px-3 py-2 text-center font-mono text-zinc-500 text-xs">-</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
