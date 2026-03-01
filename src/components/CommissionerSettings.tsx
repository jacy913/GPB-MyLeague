import React, { useState, useEffect, useMemo } from 'react';
import { Team, SimulationSettings } from '../types';
import { Save, RotateCcw, Search, AlertTriangle, Trash2, Upload, Image as ImageIcon } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../logic/simulation';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

interface CommissionerSettingsProps {
  teams: Team[];
  settings: SimulationSettings;
  onSave: (teams: Team[], settings: SimulationSettings) => void;
  onCancel: () => void;
  onClearHistoricalData: () => Promise<void>;
  isClearingHistoricalData: boolean;
  isSupabaseEnabled: boolean;
}

export const CommissionerSettings: React.FC<CommissionerSettingsProps> = ({ 
  teams: initialTeams, 
  settings: initialSettings, 
  onSave,
  onCancel,
  onClearHistoricalData,
  isClearingHistoricalData,
  isSupabaseEnabled,
}) => {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [settings, setSettings] = useState<SimulationSettings>(initialSettings);
  const [searchQuery, setSearchQuery] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadingTeamId, setUploadingTeamId] = useState<string | null>(null);
  const [logoStatusMessage, setLogoStatusMessage] = useState<string | null>(null);
  const [logoRefreshKeyByTeamId, setLogoRefreshKeyByTeamId] = useState<Record<string, number>>({});
  const [availableLogoPaths, setAvailableLogoPaths] = useState<string[]>([]);

  // Validate on team change
  useEffect(() => {
    const normalizedIds = teams.map((t) => t.id.trim().toLowerCase());
    if (normalizedIds.some((id) => id.length === 0)) {
      setValidationError('Each team must have a non-empty abbreviation (team ID).');
      return;
    }
    if (new Set(normalizedIds).size !== normalizedIds.length) {
      setValidationError('Team abbreviations (team IDs) must be unique.');
      return;
    }

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

  const handleTeamChange = (teamToUpdate: Team, field: keyof Team, value: any) => {
    setTeams((prev) =>
      prev.map((t) => (t === teamToUpdate ? { ...t, [field]: value } : t)),
    );
  };

  const handleSettingChange = (field: keyof SimulationSettings, value: number) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    const loadExistingLogos = async () => {
      if (!isSupabaseEnabled || !supabase) {
        setAvailableLogoPaths([]);
        return;
      }

      try {
        const { data, error } = await supabase.storage
          .from('teamlogos')
          .list('', { limit: 200, offset: 0 });

        if (error) {
          throw error;
        }

        setAvailableLogoPaths((data ?? []).map((item) => item.name));
      } catch (error) {
        console.error('Failed to list existing team logos:', error);
      }
    };

    void loadExistingLogos();
  }, [isSupabaseEnabled]);

  const getLogoPath = (teamId: string) => teamId.trim().toLowerCase();

  const getLogoUrl = (teamId: string) => {
    if (!supabase) {
      return null;
    }

    const path = getLogoPath(teamId);
    const { data } = supabase.storage.from('teamlogos').getPublicUrl(path);
    const refresh = logoRefreshKeyByTeamId[teamId];
    return refresh ? `${data.publicUrl}?v=${refresh}` : data.publicUrl;
  };

  const handleLogoUpload = async (team: Team, file: File | null) => {
    if (!file) {
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setLogoStatusMessage('Supabase is not configured. Add your env keys first to upload logos.');
      return;
    }

    setUploadingTeamId(team.id);
    setLogoStatusMessage(null);

    try {
      const path = getLogoPath(team.id);
      const { error } = await supabase.storage
        .from('teamlogos')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/png', cacheControl: '3600' });

      if (error) {
        throw error;
      }

      setLogoRefreshKeyByTeamId((prev) => ({
        ...prev,
        [team.id]: Date.now(),
      }));
      setAvailableLogoPaths((prev) => {
        const nextPath = getLogoPath(team.id);
        return prev.includes(nextPath) ? prev : [...prev, nextPath];
      });
      setLogoStatusMessage(`Uploaded logo for ${team.name} (${team.id.toUpperCase()}) to bucket "teamlogos".`);
    } catch (error) {
      console.error('Failed to upload team logo:', error);
      setLogoStatusMessage(`Failed to upload logo for ${team.name}.`);
    } finally {
      setUploadingTeamId(null);
    }
  };

  const leagueOrder: Team['league'][] = ['Prestige', 'Platinum'];
  const divisionOrder: Team['division'][] = ['North', 'South', 'East', 'West'];

  const filteredTeams = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const visibleTeams = teams.filter(t =>
      normalizedQuery.length === 0 ||
      t.id.toLowerCase().includes(normalizedQuery) ||
      t.name.toLowerCase().includes(normalizedQuery) ||
      t.city.toLowerCase().includes(normalizedQuery)
    );

    return visibleTeams.sort((a, b) => {
      const leagueDelta = leagueOrder.indexOf(a.league) - leagueOrder.indexOf(b.league);
      if (leagueDelta !== 0) return leagueDelta;

      const divisionDelta = divisionOrder.indexOf(a.division) - divisionOrder.indexOf(b.division);
      if (divisionDelta !== 0) return divisionDelta;

      const cityDelta = a.city.localeCompare(b.city);
      if (cityDelta !== 0) return cityDelta;

      return a.name.localeCompare(b.name);
    });
  }, [teams, searchQuery]);

  const leagueAccentText = (league: Team['league']) => (league === 'Prestige' ? 'text-prestige' : 'text-platinum');
  const leagueAccentBorder = (league: Team['league']) => (league === 'Prestige' ? 'border-l-prestige/70' : 'border-l-platinum/70');

  const handleClearHistoricalData = () => {
    const approved = window.confirm(
      'This will permanently delete all historical season runs and games from Supabase for this league. Current teams/settings stay intact. Continue?'
    );
    if (!approved) {
      return;
    }

    void onClearHistoricalData();
  };

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
      {logoStatusMessage && (
        <div className="bg-white/5 border border-white/10 p-4 rounded-lg text-zinc-200">
          <span className="font-mono text-sm">{logoStatusMessage}</span>
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
            {filteredTeams.map((team, index) => {
              const previousTeam = filteredTeams[index - 1];
              const startsNewGroup =
                index === 0 ||
                previousTeam.league !== team.league ||
                previousTeam.division !== team.division;

              return (
                <React.Fragment key={`${team.id}-${index}`}>
                  {startsNewGroup && (
                    <div className="px-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`text-xs font-display uppercase tracking-widest ${leagueAccentText(team.league)}`}>
                          {team.league}
                        </span>
                        <span className="text-xs font-mono text-slate-500 uppercase">{team.division} Division</span>
                        <div className={`h-px flex-1 ${team.league === 'Prestige' ? 'bg-prestige/40' : 'bg-platinum/40'}`} />
                      </div>
                    </div>
                  )}

                  <div
                    className={`grid grid-cols-1 md:grid-cols-6 gap-4 items-center bg-[#181818] p-3 rounded-lg border border-white/5 border-l-2 ${leagueAccentBorder(team.league)} hover:border-white/20 transition-colors`}
                  >
                    {(() => {
                      const logoPath = getLogoPath(team.id);
                      const hasLogo = availableLogoPaths.includes(logoPath);
                      const logoUrl = hasLogo ? getLogoUrl(team.id) : null;

                      return (
                        <>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Abbr</label>
                      <input
                        type="text"
                        value={team.id}
                        onChange={(e) => handleTeamChange(team, 'id', e.target.value.trim().toLowerCase())}
                        className={`w-full bg-transparent border-b border-white/10 focus:border-platinum font-mono tracking-widest ${leagueAccentText(team.league)} uppercase focus:outline-none py-1`}
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Location</label>
                      <div className={`text-[10px] uppercase tracking-widest font-mono mb-1 ${leagueAccentText(team.league)}`}>{team.league}</div>
                      <input 
                        type="text" 
                        value={team.city}
                        onChange={(e) => handleTeamChange(team, 'city', e.target.value)}
                        className="w-full bg-transparent border-b border-white/10 focus:border-platinum text-white font-display uppercase tracking-wide focus:outline-none py-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Team Name</label>
                      <input 
                        type="text" 
                        value={team.name}
                        onChange={(e) => handleTeamChange(team, 'name', e.target.value)}
                        className="w-full bg-transparent border-b border-white/10 focus:border-platinum text-white font-display uppercase tracking-wide focus:outline-none py-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">League</label>
                      <select 
                        value={team.league}
                        onChange={(e) => handleTeamChange(team, 'league', e.target.value)}
                        className={`w-full bg-[#323232] border border-white/10 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-platinum ${leagueAccentText(team.league)}`}
                      >
                        <option value="Platinum">Platinum</option>
                        <option value="Prestige">Prestige</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Division</label>
                      <select 
                        value={team.division}
                        onChange={(e) => handleTeamChange(team, 'division', e.target.value)}
                        className="w-full bg-[#323232] border border-white/10 rounded px-2 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-platinum"
                      >
                        <option value="North">North</option>
                        <option value="South">South</option>
                        <option value="East">East</option>
                        <option value="West">West</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Logo</label>
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-lg border border-white/10 bg-[#2a2a2a] flex items-center justify-center overflow-hidden">
                          {logoUrl ? (
                            <img
                              src={logoUrl}
                              alt={`${team.name} logo`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon className="w-4 h-4 text-zinc-500" />
                          )}
                        </div>
                        <label className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-xs font-mono text-zinc-300 hover:text-white hover:border-white/25 transition-colors cursor-pointer">
                          <Upload className="w-3 h-3" />
                          <span>{uploadingTeamId === team.id ? 'Uploading...' : 'Upload'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={!isSupabaseEnabled || uploadingTeamId === team.id}
                            onChange={(e) => {
                              const nextFile = e.target.files?.[0] ?? null;
                              void handleLogoUpload(team, nextFile);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                        </>
                      );
                    })()}
                  </div>
                </React.Fragment>
              );
            })}
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
                  min="0"
                  max="12"
                  step="0.5"
                  value={settings.winLossVariance}
                  onChange={(e) => handleSettingChange('winLossVariance', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-xs text-slate-500 leading-relaxed">
                  Lower values create parity. Keep between 2 and 6 for realistic standings with fewer 100-win outliers.
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

              {/* History Cleanup */}
              <div className="pt-4 border-t border-white/10">
                <div className="space-y-3">
                  <label className="font-display text-sm text-rose-300 uppercase tracking-wide">Danger Zone</label>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Clear all historical season records from Supabase to keep database usage under control.
                  </p>
                  <button
                    onClick={handleClearHistoricalData}
                    disabled={!isSupabaseEnabled || isClearingHistoricalData}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-rose-600/90 hover:bg-rose-500 disabled:bg-white/10 disabled:text-slate-500 text-white font-display font-bold tracking-wide uppercase rounded-lg transition-all shadow-lg active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isClearingHistoricalData ? 'Clearing History...' : 'Clear Historical Season Data'}
                  </button>
                  {!isSupabaseEnabled && (
                    <p className="text-[11px] text-amber-300 font-mono">
                      Supabase is not configured, so there is no remote season history to clear.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
