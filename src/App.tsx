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
import { Trophy, Activity, Settings, LayoutGrid, List } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

function App() {
  const [teams, setTeams] = useState<Team[]>(INITIAL_TEAMS);
  const [games, setGames] = useState<Game[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seasonComplete, setSeasonComplete] = useState(false);
  const [view, setView] = useState<'dashboard' | 'league_standings' | 'settings'>('dashboard');
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SETTINGS);

  // Load state from localStorage on mount
  useEffect(() => {
    const savedTeams = localStorage.getItem('glb_teams');
    const savedSettings = localStorage.getItem('glb_settings');

    if (savedTeams) {
      setTeams(JSON.parse(savedTeams));
    }
    if (savedSettings) {
      setSettings(JSON.parse(savedSettings));
    }
  }, []);

  // Initialize schedule on mount (or when teams change structure, but we handle that in save)
  useEffect(() => {
    if (games.length === 0) {
      const schedule = generateSchedule(teams);
      setGames(schedule);
    }
  }, [teams, games.length]);

  const handleSaveSettings = (newTeams: Team[], newSettings: SimulationSettings) => {
    setTeams(newTeams);
    setSettings(newSettings);
    
    // Persist
    localStorage.setItem('glb_teams', JSON.stringify(newTeams));
    localStorage.setItem('glb_settings', JSON.stringify(newSettings));
    
    // Reset season to apply changes
    resetSeason(newTeams);
    setView('dashboard');
  };

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
        setIsSimulating(false);
        setSeasonComplete(true);
      }
    };

    requestAnimationFrame(processBatch);
  }, [teams, settings]);

  const resetSeason = (teamsToReset = teams) => {
    setTeams(teamsToReset.map(t => ({...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0})));
    setProgress(0);
    setSeasonComplete(false);
  };

  const getDivisionTeams = (league: string, division: string) => {
    return teams.filter(t => t.league === league && t.division === division);
  };

  const getLeagueTeams = (league: string) => {
    return teams.filter(t => t.league === league);
  };

  return (
    <div className="min-h-screen bg-[#181818] text-white font-sans selection:bg-prestige/30">
      {/* Header */}
      <header className="bg-[#181818] border-b border-white/10 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('dashboard')}>
            <div className="w-10 h-10 bg-gradient-to-br from-prestige to-yellow-600 rounded-lg flex items-center justify-center shadow-lg">
              <Trophy className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl uppercase tracking-wider text-white leading-none">
                Grand League
              </h1>
              <span className="text-xs text-slate-400 font-mono tracking-widest uppercase">Baseball Simulation</span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-slate-400 hidden md:flex">
              <Activity className="w-4 h-4 text-platinum" />
              <span className="font-mono">SEASON 2026</span>
            </div>
            
            <div className="flex bg-[#323232] rounded-lg p-1 border border-white/10">
              <button 
                onClick={() => setView('dashboard')}
                className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded-md transition-all ${view === 'dashboard' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
              >
                Division
              </button>
              <button 
                onClick={() => setView('league_standings')}
                className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded-md transition-all ${view === 'league_standings' ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
              >
                League
              </button>
            </div>

            <button 
              onClick={() => setView(view === 'settings' ? 'dashboard' : 'settings')}
              className={`p-2 rounded-lg transition-colors ${view === 'settings' ? 'bg-white/10 text-white' : 'hover:bg-[#323232] text-slate-400'}`}
              title="Commissioner Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {view === 'dashboard' ? (
            <motion.div
              key="dashboard"
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
                  
                  {view === 'dashboard' && (
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
                          <div className="h-px flex-1 bg-gradient-to-r from-prestige/50 to-transparent" />
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
                          <div className="h-px flex-1 bg-gradient-to-r from-platinum/50 to-transparent" />
                        </div>
                        <StandingsTable divisionName="North" teams={getDivisionTeams('Platinum', 'North')} headerColor="text-platinum" />
                        <StandingsTable divisionName="South" teams={getDivisionTeams('Platinum', 'South')} headerColor="text-platinum" />
                        <StandingsTable divisionName="East" teams={getDivisionTeams('Platinum', 'East')} headerColor="text-platinum" />
                        <StandingsTable divisionName="West" teams={getDivisionTeams('Platinum', 'West')} headerColor="text-platinum" />
                      </div>
                    </motion.div>
                  )}

                  {view === 'league_standings' && (
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
                      <h4 className="font-display text-xs uppercase tracking-widest text-slate-500 mb-2">Simulation Logic</h4>
                      <div className="space-y-2 text-xs text-slate-400 font-mono">
                        <div className="flex justify-between">
                          <span>Continuity:</span>
                          <span className="text-emerald-400">{(settings.continuityWeight * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Variance:</span>
                          <span className="text-emerald-400">{settings.winLossVariance}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </motion.div>
          ) : (
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
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;

