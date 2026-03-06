import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TeamLogo } from './TeamLogo';
import { formatHeaderDate } from './SeasonCalendarStrip';
import {
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryTeamRecord,
  Team,
} from '../types';

export interface SeasonAwardsSelectionState {
  seasonYear: number;
  champion: SeasonHistoryTeamRecord | null;
  divisionWinners: SeasonHistoryDivisionWinner[];
  battingCandidates: SeasonHistoryAwardWinner[];
  pitchingCandidates: SeasonHistoryAwardWinner[];
  worldSeriesCandidates: SeasonHistoryAwardWinner[];
  worldSeriesCompletedGames: number;
  worldSeriesStartDate: string;
  worldSeriesEndDate: string;
  selectedBattingPlayerId: string | null;
  selectedPitchingPlayerId: string | null;
  selectedWorldSeriesPlayerId: string | null;
}

interface SeasonAwardsModalProps {
  selection: SeasonAwardsSelectionState | null;
  resolveAwardCandidateTeam: (candidate: SeasonHistoryAwardWinner) => Team | null;
  onSelectBattingPlayer: (playerId: string) => void;
  onSelectPitchingPlayer: (playerId: string) => void;
  onSelectWorldSeriesPlayer: (playerId: string) => void;
  onAutoPickLeaders: () => void;
  onSaveAwardWinners: (selection: SeasonAwardsSelectionState) => void;
}

export const SeasonAwardsModal = ({
  selection,
  resolveAwardCandidateTeam,
  onSelectBattingPlayer,
  onSelectPitchingPlayer,
  onSelectWorldSeriesPlayer,
  onAutoPickLeaders,
  onSaveAwardWinners,
}: SeasonAwardsModalProps) => (
  <AnimatePresence>
    {selection && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[86] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          className="w-full max-w-6xl rounded-[2rem] border border-[#d4bb6a]/30 bg-[linear-gradient(145deg,#101010,#181818,#0b0b0b)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)] md:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Season Awards Ballot</p>
              <p className="mt-2 font-headline text-4xl uppercase tracking-[0.08em] text-white">
                Choose {selection.seasonYear} MVP Winners
              </p>
              <p className="mt-2 text-sm text-zinc-300">
                Pick Batting MVP, Pitching MVP, and World Series MVP before archiving the season snapshot.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Champion</p>
              <p className="mt-1 font-display text-xl uppercase tracking-[0.08em] text-white">
                {selection.champion ? `${selection.champion.teamCity} ${selection.champion.teamName}` : 'TBD'}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                {selection.worldSeriesCompletedGames > 0
                  ? `${selection.worldSeriesCompletedGames} World Series games`
                  : 'World Series not completed'}
              </p>
            </div>
          </div>

          <div className="mt-5 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <section className="rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Regular Season</p>
                  <p className="mt-1 font-headline text-2xl uppercase tracking-[0.08em] text-white">Batting MVP</p>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Click a player card to select</p>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {selection.battingCandidates.length === 0 ? (
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No eligible candidates</p>
                ) : (
                  selection.battingCandidates.map((candidate) => {
                    const candidateTeam = resolveAwardCandidateTeam(candidate);
                    const isSelected = selection.selectedBattingPlayerId === candidate.playerId;
                    return (
                      <button
                        type="button"
                        key={`batting-list-${candidate.playerId}`}
                        onClick={() => onSelectBattingPlayer(candidate.playerId)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${isSelected ? 'border-[#d4bb6a]/55 bg-[#d4bb6a]/10' : 'border-white/10 bg-black/25 hover:border-white/20'}`}
                      >
                        <div className="flex items-center gap-3">
                          {candidateTeam ? (
                            <TeamLogo team={candidateTeam} sizeClass="h-12 w-12" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg border border-white/10 bg-black/30" />
                          )}
                          <div className="min-w-0">
                            <p className="font-display text-2xl uppercase tracking-[0.06em] text-white truncate">{candidate.playerName}</p>
                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 truncate">
                              {candidate.teamCity && candidate.teamName ? `${candidate.teamCity} ${candidate.teamName}` : 'No Team'}
                            </p>
                            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-platinum">{candidate.summary}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Regular Season</p>
                  <p className="mt-1 font-headline text-2xl uppercase tracking-[0.08em] text-white">Pitching MVP</p>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Click a player card to select</p>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {selection.pitchingCandidates.length === 0 ? (
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No eligible candidates</p>
                ) : (
                  selection.pitchingCandidates.map((candidate) => {
                    const candidateTeam = resolveAwardCandidateTeam(candidate);
                    const isSelected = selection.selectedPitchingPlayerId === candidate.playerId;
                    return (
                      <button
                        type="button"
                        key={`pitching-list-${candidate.playerId}`}
                        onClick={() => onSelectPitchingPlayer(candidate.playerId)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${isSelected ? 'border-[#d4bb6a]/55 bg-[#d4bb6a]/10' : 'border-white/10 bg-black/25 hover:border-white/20'}`}
                      >
                        <div className="flex items-center gap-3">
                          {candidateTeam ? (
                            <TeamLogo team={candidateTeam} sizeClass="h-12 w-12" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg border border-white/10 bg-black/30" />
                          )}
                          <div className="min-w-0">
                            <p className="font-display text-2xl uppercase tracking-[0.06em] text-white truncate">{candidate.playerName}</p>
                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 truncate">
                              {candidate.teamCity && candidate.teamName ? `${candidate.teamCity} ${candidate.teamName}` : 'No Team'}
                            </p>
                            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-platinum">{candidate.summary}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">World Series</p>
                  <p className="mt-1 font-headline text-2xl uppercase tracking-[0.08em] text-white">World Series MVP</p>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    {selection.worldSeriesCompletedGames > 0
                      ? `Stats shown from ${formatHeaderDate(selection.worldSeriesStartDate)} to ${formatHeaderDate(selection.worldSeriesEndDate)} (${selection.worldSeriesCompletedGames} games).`
                      : 'No completed World Series games found yet.'}
                  </p>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Click a player card to select</p>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {selection.worldSeriesCandidates.length === 0 ? (
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No WS candidates available</p>
                ) : (
                  selection.worldSeriesCandidates.map((candidate) => {
                    const candidateTeam = resolveAwardCandidateTeam(candidate);
                    const isSelected = selection.selectedWorldSeriesPlayerId === candidate.playerId;
                    return (
                      <button
                        type="button"
                        key={`world-series-list-${candidate.playerId}`}
                        onClick={() => onSelectWorldSeriesPlayer(candidate.playerId)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${isSelected ? 'border-[#d4bb6a]/55 bg-[#d4bb6a]/10' : 'border-white/10 bg-black/25 hover:border-white/20'}`}
                      >
                        <div className="flex items-center gap-3">
                          {candidateTeam ? (
                            <TeamLogo team={candidateTeam} sizeClass="h-12 w-12" />
                          ) : (
                            <div className="h-12 w-12 rounded-lg border border-white/10 bg-black/30" />
                          )}
                          <div className="min-w-0">
                            <p className="font-display text-2xl uppercase tracking-[0.06em] text-white truncate">{candidate.playerName}</p>
                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 truncate">
                              {candidate.teamCity && candidate.teamName ? `${candidate.teamCity} ${candidate.teamName}` : 'No Team'}
                            </p>
                            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-platinum">{candidate.summary}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onAutoPickLeaders}
              className="rounded-2xl border border-white/15 bg-black/30 px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-zinc-200 transition-colors hover:border-white/25 hover:text-white"
            >
              Auto-Pick Leaders
            </button>
            <button
              type="button"
              onClick={() => onSaveAwardWinners(selection)}
              className="rounded-2xl border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.28),rgba(212,187,106,0.1))] px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-white"
            >
              Save Award Winners
            </button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
