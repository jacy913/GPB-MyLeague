import React, { useState, useEffect } from 'react';
import { Team, SimulationSettings } from '../types';
import { Save, RotateCcw, Search, AlertTriangle } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../logic/simulation';

interface CommissionerSettingsProps {
  teams: Team[];
  settings: SimulationSettings;
  onSave: (teams: Team[], settings: SimulationSettings) => void;
  onCancel: () => void;
}

export const CommissionerSettings: React.FC<CommissionerSettingsProps> = ({ 
  teams: initialTeams, 
  settings: initialSettings, 
  onSave,
  onCancel
}) => {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [settings, setSettings] = useState<SimulationSettings>(initialSettings);
  const [searchQuery, setSearchQuery] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Validate on team change
  useEffect(() => {
    // Check team count
    if (teams.length !== 32) {
      setValidationError(`Total teams must be 32. Current: ${teams.length}`);
      return;
    }

    // Check division balance
    const divisions: Record<string, number> = {};
    teams.forEach(t => {
      const key = `${t.league} ${t.division}`;
      divisions[key] = (divisions[key] || 0) + 1;
    });

    const unbalanced = Object.entries(divisions).filter(([_, count]) => count !== 4);
    if (unbalanced.length > 0) {
      setValidationError(`Divisions must have 4 teams. Unbalanced: ${unbalanced.map(u => u[0]).join(', ')}`);
      return;
    }

    setValidationError(null);
  }, [teams]);

  const handleTeamChange = (id: string, field: keyof Team, value: any) => {
    setTeams(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const handleSettingChange = (field: keyof SimulationSettings, value: number) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const filteredTeams = teams.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-display text-3xl uppercase text-white tracking-widest">Commissioner Settings</h2>
          <p className="text-slate-400 font-mono text-sm mt-1">Configure League Structure & Simulation Engine</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 text-slate-400 hover:text-white font-display uppercase tracking-wide transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(teams, settings)}
            disabled={!!validationError}
            className="flex items-center gap-2 px-6 py-2 bg-platinum hover:bg-platinum/80 disabled:bg-white/10 disabled:text-slate-500 text-white font-display font-bold tracking-wide uppercase rounded-lg transition-all shadow-lg active:scale-95"
          >
            <Save className="w-4 h-4" />
            Save & Apply
          </button>
        </div>
      </div>

      {validationError && (
        <div className="bg-rose-500/10 border border-rose-500/50 p-4 rounded-lg flex items-center gap-3 text-rose-200">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="font-mono text-sm">{validationError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Column 1: Team Management (2 cols wide) */}
        <div className="lg:col-span-2 bg-[#323232] rounded-xl border border-white/10 p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-display text-xl uppercase text-white tracking-wide">Team Management</h3>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search teams..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-[#181818] border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-platinum w-64 font-mono"
              />
            </div>
          </div>

          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {filteredTeams.map(team => (
              <div key={team.id} className="grid grid-cols-12 gap-4 items-center bg-[#181818] p-3 rounded-lg border border-white/5 hover:border-white/20 transition-colors">
                <div className="col-span-3">
                  <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Location</label>
                  <input 
                    type="text" 
                    value={team.city}
                    onChange={(e) => handleTeamChange(team.id, 'city', e.target.value)}
                    className="w-full bg-transparent border-b border-white/10 focus:border-platinum text-white font-display uppercase tracking-wide focus:outline-none py-1"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Team Name</label>
                  <input 
                    type="text" 
                    value={team.name}
                    onChange={(e) => handleTeamChange(team.id, 'name', e.target.value)}
                    className="w-full bg-transparent border-b border-white/10 focus:border-platinum text-white font-display uppercase tracking-wide focus:outline-none py-1"
                  />
                </div>
                <div className="col-span-3">
                  <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">League</label>
                  <select 
                    value={team.league}
                    onChange={(e) => handleTeamChange(team.id, 'league', e.target.value)}
                    className="w-full bg-[#323232] border border-white/10 rounded px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-platinum"
                  >
                    <option value="Platinum">Platinum</option>
                    <option value="Prestige">Prestige</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Division</label>
                  <select 
                    value={team.division}
                    onChange={(e) => handleTeamChange(team.id, 'division', e.target.value)}
                    className="w-full bg-[#323232] border border-white/10 rounded px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-platinum"
                  >
                    <option value="North">North</option>
                    <option value="South">South</option>
                    <option value="East">East</option>
                    <option value="West">West</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Simulation Tuning (1 col wide) */}
        <div className="space-y-6">
          <div className="bg-[#323232] rounded-xl border border-white/10 p-6 sticky top-24">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display text-xl uppercase text-white tracking-wide">Sim Engine</h3>
              <button 
                onClick={() => setSettings(DEFAULT_SETTINGS)}
                className="text-xs text-slate-500 hover:text-platinum flex items-center gap-1 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Defaults
              </button>
            </div>

            <div className="space-y-8">
              {/* Continuity Weight */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <label className="font-display text-sm text-slate-300 uppercase tracking-wide">Continuity Weight</label>
                  <span className="font-mono text-platinum text-sm">{(settings.continuityWeight * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.05"
                  value={settings.continuityWeight}
                  onChange={(e) => handleSettingChange('continuityWeight', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Determines how much previous season performance impacts new baseline ratings vs fresh randomness.
                </p>
              </div>

              {/* Win-Loss Variance */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <label className="font-display text-sm text-slate-300 uppercase tracking-wide">Win-Loss Variance (σ)</label>
                  <span className="font-mono text-platinum text-sm">{settings.winLossVariance}</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="25" 
                  step="1"
                  value={settings.winLossVariance}
                  onChange={(e) => handleSettingChange('winLossVariance', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Higher values create "Super Teams" and "Tankers". Lower values create parity.
                </p>
              </div>

              {/* Home Field Advantage */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <label className="font-display text-sm text-slate-300 uppercase tracking-wide">Home Field Adv.</label>
                  <span className="font-mono text-platinum text-sm">{settings.homeFieldAdvantage.toFixed(3)}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="0.1" 
                  step="0.005"
                  value={settings.homeFieldAdvantage}
                  onChange={(e) => handleSettingChange('homeFieldAdvantage', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Probability boost for the home team. Default is 0.035.
                </p>
              </div>

              {/* Game Luck/Noise */}
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <label className="font-display text-sm text-slate-300 uppercase tracking-wide">Game Noise</label>
                  <span className="font-mono text-platinum text-sm">{(settings.gameLuckFactor * 100).toFixed(0)}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="0.5" 
                  step="0.01"
                  value={settings.gameLuckFactor}
                  onChange={(e) => handleSettingChange('gameLuckFactor', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Randomness factor in game outcomes. Higher means more upsets.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
