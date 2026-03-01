/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { INITIAL_TEAMS } from './data/teams';
import { generateSchedule, simulateGame, recalculateTeamRatings, DEFAULT_SETTINGS } from './logic/simulation';
import { Team, Game, SimulationSettings } from './types';
import { StandingsTable } from './components/StandingsTable';
import { LeagueTable } from './components/LeagueTable';
import { Leaderboard } from './components/Leaderboard';
import { Controls } from './components/Controls';
import { CommissionerSettings } from './components/CommissionerSettings';
import { Activity, Settings, Bell, ChevronDown, ChevronUp } from 'lucide-react';
import gpbLogo from './assets/gpb.png';
import { motion, AnimatePresence } from 'motion/react';
import { isSupabaseConfigured } from './lib/supabaseClient';
import {
  clearSupabaseSeasonHistory,
  loadLocalLeagueState,
  loadSupabaseLeagueState,
  saveLocalLeagueState,
  saveSupabaseLeagueState,
  saveSupabaseSeasonRun,
  seedSupabaseLeagueState,
} from './lib/storage';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

interface CommissionerNotice {
  id: string;
  message: string;
  level: NoticeLevel;
  createdAt: string;
}

const NOTICE_LEVEL_CLASS: Record<NoticeLevel, string> = {
  info: 'text-zinc-300',
  success: 'text-white',
  warning: 'text-zinc-200',
  error: 'text-zinc-400',
};

const EXPECTED_TEAM_COUNT = 32;

const isValidTeamShape = (value: unknown): value is Team => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const team = value as Partial<Team>;
  return (
    typeof team.id === 'string' &&
    typeof team.name === 'string' &&
    typeof team.city === 'string' &&
    (team.league === 'Prestige' || team.league === 'Platinum') &&
    (team.division === 'North' || team.division === 'South' || team.division === 'East' || team.division === 'West') &&
    typeof team.rating === 'number' &&
    typeof team.previousBaselineWins === 'number' &&
    typeof team.wins === 'number' &&
    typeof team.losses === 'number' &&
    typeof team.runsScored === 'number' &&
    typeof team.runsAllowed === 'number'
  );
};

const sanitizeTeams = (value: unknown): Team[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.length !== EXPECTED_TEAM_COUNT) {
    return null;
  }

  return value.every(isValidTeamShape) ? (value as Team[]) : null;
};

const isValidSettingsShape = (value: unknown): value is SimulationSettings => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as Partial<SimulationSettings>;
  return (
    typeof settings.continuityWeight === 'number' &&
    typeof settings.winLossVariance === 'number' &&
    typeof settings.homeFieldAdvantage === 'number' &&
    typeof settings.gameLuckFactor === 'number'
  );
};

function App() {
  const [teams, setTeams] = useState<Team[]>(INITIAL_TEAMS);
  const [games, setGames] = useState<Game[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seasonComplete, setSeasonComplete] = useState(false);
  const [view, setView] = useState<'dashboard' | 'league_standings' | 'settings'>('dashboard');
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SETTINGS);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [dataSource, setDataSource] = useState<'supabase' | 'local'>('local');
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isNoticeBarOpen, setIsNoticeBarOpen] = useState(false);
  const [commissionerNotices, setCommissionerNotices] = useState<CommissionerNotice[]>([]);

  const pushNotice = useCallback((message: string, level: NoticeLevel = 'info') => {
    const createdAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setCommissionerNotices((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message,
        level,
        createdAt,
      },
      ...prev,
    ].slice(0, 30));
  }, []);

  const persistLeagueState = useCallback(async (nextTeams: Team[], nextSettings: SimulationSettings) => {
    saveLocalLeagueState(nextTeams, nextSettings);

    if (!isSupabaseConfigured) {
      return;
    }

    await saveSupabaseLeagueState(nextTeams, nextSettings);
    setDataSource('supabase');
  }, []);

  // Load state on mount and seed Supabase if empty.
  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true);

      try {
        if (isSupabaseConfigured) {
          await seedSupabaseLeagueState(INITIAL_TEAMS, DEFAULT_SETTINGS);
          const remoteState = await loadSupabaseLeagueState();
          const validRemoteTeams = sanitizeTeams(remoteState.teams);
          const validRemoteSettings = isValidSettingsShape(remoteState.settings) ? remoteState.settings : null;

          if (validRemoteTeams) {
            setTeams(validRemoteTeams);
          }
          if (validRemoteSettings) {
            setSettings(validRemoteSettings);
          }

          if (validRemoteTeams && validRemoteSettings) {
            saveLocalLeagueState(validRemoteTeams, validRemoteSettings);
          }

          setDataSource('supabase');
          return;
        }

        const localState = loadLocalLeagueState();
        const validLocalTeams = sanitizeTeams(localState.teams);
        const validLocalSettings = isValidSettingsShape(localState.settings) ? localState.settings : null;

        if (validLocalTeams) {
          setTeams(validLocalTeams);
        }
        if (validLocalSettings) {
          setSettings(validLocalSettings);
        }
        setDataSource('local');
      } catch (error) {
        console.error('Failed to load Supabase state, falling back to local storage:', error);
        const localState = loadLocalLeagueState();
        const validLocalTeams = sanitizeTeams(localState.teams);
        const validLocalSettings = isValidSettingsShape(localState.settings) ? localState.settings : null;

        if (validLocalTeams) {
          setTeams(validLocalTeams);
        }
        if (validLocalSettings) {
          setSettings(validLocalSettings);
        }
        setDataSource('local');
        pushNotice('Supabase sync failed. Using local storage fallback.', 'warning');
      } finally {
        setIsBootstrapping(false);
      }
    };

    void bootstrap();
  }, [pushNotice]);

  // Initialize schedule on mount (or when teams change structure, but we handle that in save)
  useEffect(() => {
    if (!isBootstrapping && games.length === 0) {
      const schedule = generateSchedule(teams);
      setGames(schedule);
    }
  }, [teams, games.length, isBootstrapping]);

  const resetSeason = useCallback((teamsToReset = teams, settingsToUse = settings) => {
    const resetTeams = teamsToReset.map(t => ({...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0}));
    setTeams(resetTeams);
    setGames(generateSchedule(resetTeams));
    setProgress(0);
    setSeasonComplete(false);

    void (async () => {
      try {
        await persistLeagueState(resetTeams, settingsToUse);
      } catch (error) {
        console.error('Failed to persist reset season state:', error);
        pushNotice('Season reset locally, but Supabase sync failed.', 'warning');
      }
    })();
  }, [teams, settings, persistLeagueState, pushNotice]);

  const handleSaveSettings = (newTeams: Team[], newSettings: SimulationSettings) => {
    setSettings(newSettings);
    resetSeason(newTeams, newSettings);
    pushNotice(
      isSupabaseConfigured ? 'League settings updated and season reset.' : 'League settings updated locally.',
      'success',
    );
    setView('dashboard');
  };

  const handleClearHistoricalData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      pushNotice('Supabase is not configured. No historical season data to clear.', 'warning');
      return;
    }

    setIsClearingHistory(true);
    try {
      const deletedRuns = await clearSupabaseSeasonHistory();
      if (deletedRuns > 0) {
        pushNotice(`Cleared ${deletedRuns} historical season runs from Supabase.`, 'success');
      } else {
        pushNotice('No historical season data found to clear.', 'info');
      }
    } catch (error) {
      console.error('Failed to clear historical season data:', error);
      pushNotice('Failed to clear historical season data from Supabase.', 'error');
    } finally {
      setIsClearingHistory(false);
    }
  }, [pushNotice]);

  const runSimulation = useCallback(async () => {
    setIsSimulating(true);
    setSeasonComplete(false);
    
    // 1. Recalculate Ratings based on Settings (Continuity, Variance)
    // This represents the "New Season" baseline generation
    const ratedTeams = recalculateTeamRatings(teams, settings);
    
    // Reset stats
    const currentTeams = ratedTeams.map(t => ({...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0}));
    const currentGames = generateSchedule(currentTeams); 
    
    const batchSize = 50;
    const totalGames = currentGames.length;
    let gamesPlayed = 0;

    const processBatch = () => {
      const batchEnd = Math.min(gamesPlayed + batchSize, totalGames);
      
      for (let i = gamesPlayed; i < batchEnd; i++) {
        const game = currentGames[i];
        const homeTeam = currentTeams.find(t => t.id === game.homeTeamId)!;
        const awayTeam = currentTeams.find(t => t.id === game.awayTeamId)!;
        
        // Pass settings to simulateGame for HFA and Luck
        const result = simulateGame(homeTeam, awayTeam, settings);
        
        game.homeScore = result.homeScore;
        game.awayScore = result.awayScore;
        game.played = true;
        
        homeTeam.runsScored += result.homeScore;
        homeTeam.runsAllowed += result.awayScore;
        awayTeam.runsScored += result.awayScore;
        awayTeam.runsAllowed += result.homeScore;
        
        if (result.homeScore > result.awayScore) {
          homeTeam.wins++;
          awayTeam.losses++;
        } else {
          awayTeam.wins++;
          homeTeam.losses++;
        }
      }
      
      gamesPlayed = batchEnd;
      setTeams([...currentTeams]); 
      setProgress((gamesPlayed / totalGames) * 100);

      if (gamesPlayed < totalGames) {
        requestAnimationFrame(processBatch);
      } else {
        const finalizedTeams = currentTeams.map((team) => ({
          ...team,
          previousBaselineWins: team.wins,
        }));

        setTeams(finalizedTeams);
        setGames([...currentGames]);
        setIsSimulating(false);
        setSeasonComplete(true);

        void (async () => {
          try {
            await persistLeagueState(finalizedTeams, settings);
            if (isSupabaseConfigured) {
              const seasonLabel = `Season ${new Date().getFullYear()}`;
              await saveSupabaseSeasonRun(finalizedTeams, currentGames, settings, seasonLabel);
              pushNotice('Season simulation saved to Supabase.', 'success');
            } else {
              pushNotice('Season simulation saved locally.', 'info');
            }
          } catch (error) {
            console.error('Failed to persist simulation results:', error);
            pushNotice('Season completed, but Supabase sync failed. Local copy is still available.', 'warning');
          }
        })();
      }
    };

    requestAnimationFrame(processBatch);
  }, [teams, settings, persistLeagueState, pushNotice]);

  const getDivisionTeams = (league: string, division: string) => {
    return teams.filter(t => t.league === league && t.division === division);
  };

  const getLeagueTeams = (league: string) => {
    return teams.filter(t => t.league === league);
  };

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#181818] text-white font-sans flex items-center justify-center">
        <div className="text-center space-y-2">
          <img src={gpbLogo} alt="GPB" className="mx-auto h-16 w-auto object-contain" />
          <p className="text-slate-400 font-mono text-sm">Loading league data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans selection:bg-white/20 relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-40 -left-24 w-[420px] h-[420px] rounded-full bg-prestige/15 blur-3xl" />
        <div className="absolute top-[28%] -right-20 w-[360px] h-[360px] rounded-full bg-platinum/15 blur-3xl" />
        <div className="absolute bottom-0 left-[32%] w-[520px] h-[240px] bg-gradient-to-r from-transparent via-white/5 to-transparent blur-2xl" />
      </div>

      {/* Header */}
      <header className="bg-[#151515]/95 backdrop-blur border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('dashboard')}>
            <img src={gpbLogo} alt="GPB home" className="h-10 w-auto object-contain" />
            <span className="font-logo text-xl sm:text-2xl leading-none tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
              My League
            </span>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
              <Activity className="w-4 h-4 text-prestige" />
              <span className="font-mono">SEASON 2026</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
              <span className={`w-2 h-2 rounded-full ${dataSource === 'supabase' ? 'bg-platinum' : 'bg-prestige'}`} />
              <span className="font-mono">{dataSource === 'supabase' ? 'SUPABASE' : 'LOCAL'}</span>
            </div>
            
            <div className="flex bg-[#242424] rounded-lg p-1 border border-white/10 shadow-inner shadow-black/40">
              <button 
                onClick={() => setView('dashboard')}
                className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded-md transition-all ${view === 'dashboard' ? 'bg-prestige text-black shadow-sm' : 'text-zinc-400 hover:text-prestige'}`}
              >
                Division
              </button>
              <button 
                onClick={() => setView('league_standings')}
                className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded-md transition-all ${view === 'league_standings' ? 'bg-platinum text-black shadow-sm' : 'text-zinc-400 hover:text-platinum'}`}
              >
                League
              </button>
            </div>

            <button 
              onClick={() => setIsNoticeBarOpen((prev) => !prev)}
              className={`relative flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                isNoticeBarOpen ? 'bg-white/10 text-white' : 'hover:bg-[#323232] text-zinc-400'
              }`}
              title="Commissioner Notifications"
            >
              <Bell className="w-5 h-5" />
              <span className="text-xs font-display uppercase tracking-wider hidden md:inline">Notices</span>
              {isNoticeBarOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {commissionerNotices.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-platinum text-black text-[10px] font-mono flex items-center justify-center">
                  {commissionerNotices.length > 9 ? '9+' : commissionerNotices.length}
                </span>
              )}
            </button>

            <button 
              onClick={() => setView(view === 'settings' ? 'dashboard' : 'settings')}
              className={`p-2 rounded-lg transition-colors ${view === 'settings' ? 'bg-white/10 text-white' : 'hover:bg-[#323232] text-zinc-400'}`}
              title="Commissioner Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isNoticeBarOpen && (
            <motion.div
              key="commissioner-notices"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-white/10 overflow-hidden"
            >
              <div className="max-w-7xl mx-auto px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-display text-xs uppercase tracking-widest text-zinc-400">Commissioner Notifications</h3>
                  <button
                    onClick={() => setCommissionerNotices([])}
                    disabled={commissionerNotices.length === 0}
                    className="text-xs font-mono text-zinc-500 hover:text-white disabled:text-zinc-700 transition-colors"
                  >
                    Clear Feed
                  </button>
                </div>

                {commissionerNotices.length === 0 ? (
                  <p className="text-xs font-mono text-zinc-500">No notifications yet.</p>
                ) : (
                  <ul className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {commissionerNotices.map((notice) => (
                      <li key={notice.id} className="bg-[#323232] border border-white/10 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
                        <span className={`text-xs font-mono ${NOTICE_LEVEL_CLASS[notice.level]}`}>{notice.message}</span>
                        <span className="text-[10px] font-mono text-zinc-500 shrink-0">{notice.createdAt}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 relative z-10">
        <AnimatePresence mode="wait">
          {view === 'settings' ? (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              <CommissionerSettings 
                teams={teams} 
                settings={settings} 
                onSave={handleSaveSettings}
                onCancel={() => setView('dashboard')}
                onClearHistoricalData={handleClearHistoricalData}
                isClearingHistoricalData={isClearingHistory}
                isSupabaseEnabled={isSupabaseConfigured}
              />
            </motion.div>
          ) : (
            <motion.div
              key={view}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Controls Section */}
              <motion.section 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-8"
              >
                <Controls 
                  onSimulate={runSimulation} 
                  onReset={() => resetSeason()}
                  isSimulating={isSimulating}
                  progress={progress}
                  seasonComplete={seasonComplete}
                />
              </motion.section>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                {/* Main Content Area (3 cols) */}
                <div className="lg:col-span-3">
                  {view === 'dashboard' ? (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="grid grid-cols-1 md:grid-cols-2 gap-8"
                    >
                      {/* Prestige League Column */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3 mb-2">
                          <h2 className="font-display text-2xl uppercase text-prestige tracking-widest">Prestige</h2>
                          <div className="h-px flex-1 bg-gradient-to-r from-prestige/60 to-transparent" />
                        </div>
                        <StandingsTable divisionName="North" teams={getDivisionTeams('Prestige', 'North')} headerColor="text-prestige" />
                        <StandingsTable divisionName="South" teams={getDivisionTeams('Prestige', 'South')} headerColor="text-prestige" />
                        <StandingsTable divisionName="East" teams={getDivisionTeams('Prestige', 'East')} headerColor="text-prestige" />
                        <StandingsTable divisionName="West" teams={getDivisionTeams('Prestige', 'West')} headerColor="text-prestige" />
                      </div>

                      {/* Platinum League Column */}
                      <div className="space-y-6">
                        <div className="flex items-center gap-3 mb-2">
                          <h2 className="font-display text-2xl uppercase text-platinum tracking-widest">Platinum</h2>
                          <div className="h-px flex-1 bg-gradient-to-r from-platinum/60 to-transparent" />
                        </div>
                        <StandingsTable divisionName="North" teams={getDivisionTeams('Platinum', 'North')} headerColor="text-platinum" />
                        <StandingsTable divisionName="South" teams={getDivisionTeams('Platinum', 'South')} headerColor="text-platinum" />
                        <StandingsTable divisionName="East" teams={getDivisionTeams('Platinum', 'East')} headerColor="text-platinum" />
                        <StandingsTable divisionName="West" teams={getDivisionTeams('Platinum', 'West')} headerColor="text-platinum" />
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="space-y-12"
                    >
                      <LeagueTable leagueName="Prestige League" teams={getLeagueTeams('Prestige')} headerColor="text-prestige" />
                      <LeagueTable leagueName="Platinum League" teams={getLeagueTeams('Platinum')} headerColor="text-platinum" />
                    </motion.div>
                  )}
                </div>

                {/* Sidebar (1 col) */}
                <aside className="lg:col-span-1">
                  <div className="sticky top-24">
                    <Leaderboard teams={teams} />
                    
                    {/* Additional Stats / Info */}
                    <div className="mt-8 p-4 bg-[#323232] rounded-lg border border-white/10">
                      <h4 className="font-display text-xs uppercase tracking-widest text-zinc-500 mb-2">Simulation Logic</h4>
                      <div className="space-y-2 text-xs text-zinc-400 font-mono">
                        <div className="flex justify-between">
                          <span>Continuity:</span>
                          <span className="text-prestige">{(settings.continuityWeight * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Variance:</span>
                          <span className="text-platinum">{settings.winLossVariance}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;


