import React, { useState, useEffect, useMemo } from 'react';
import { LeaguePlayerState, Team, SimulationSettings } from '../types';
import { Save, RotateCcw, Search, AlertTriangle, Trash2, Image as ImageIcon, Users } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../logic/simulation';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import {
  deleteSupabaseSliderPreset,
  loadSupabaseSliderPresets,
  saveSupabaseSliderPreset,
  SliderPresetRecord,
} from '../lib/storage';

interface CommissionerSettingsProps {
  teams: Team[];
  settings: SimulationSettings;
  onSave: (teams: Team[], settings: SimulationSettings) => void;
  onCancel: () => void;
  onClearHistoricalData: () => Promise<void>;
  onPreviewGeneratePlayers: () => void;
  onGeneratePlayers: () => Promise<void>;
  onHardWipePlayers: () => Promise<void>;
  onDismissPlayerPreview: () => void;
  playerGenerationPreview: LeaguePlayerState | null;
  isClearingHistoricalData: boolean;
  isGeneratingPlayers: boolean;
  isWipingPlayers: boolean;
  isSupabaseEnabled: boolean;
}

export const CommissionerSettings: React.FC<CommissionerSettingsProps> = ({ 
  teams: initialTeams, 
  settings: initialSettings, 
  onSave,
  onCancel,
  onClearHistoricalData,
  onPreviewGeneratePlayers,
  onGeneratePlayers,
  onHardWipePlayers,
  onDismissPlayerPreview,
  playerGenerationPreview,
  isClearingHistoricalData,
  isGeneratingPlayers,
  isWipingPlayers,
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
  const [sliderPresetName, setSliderPresetName] = useState('');
  const [sliderPresets, setSliderPresets] = useState<SliderPresetRecord[]>([]);
  const [sliderPresetStatus, setSliderPresetStatus] = useState<string | null>(null);
  const [isSavingSliderPreset, setIsSavingSliderPreset] = useState(false);
  const [deletingSliderPresetId, setDeletingSliderPresetId] = useState<number | null>(null);

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
        const reason = error instanceof Error ? error.message : 'Unknown storage error';
        setLogoStatusMessage(`Unable to load existing logos from bucket "teamlogos": ${reason}`);
      }
    };

    void loadExistingLogos();
  }, [isSupabaseEnabled]);

  useEffect(() => {
    const loadPresets = async () => {
      if (!isSupabaseEnabled) {
        setSliderPresets([]);
        return;
      }

      try {
        const presets = await loadSupabaseSliderPresets();
        setSliderPresets(presets);
      } catch (error) {
        console.error('Failed to load slider presets:', error);
        setSliderPresetStatus('Unable to load slider presets from Supabase.');
      }
    };

    void loadPresets();
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
      const { data: existingObjects, error: listError } = await supabase.storage
        .from('teamlogos')
        .list('', { limit: 500, offset: 0, search: path });

      if (listError) {
        throw listError;
      }

      const existingNames = (existingObjects ?? [])
        .map((item) => item.name)
        .filter((name) => name === path || name.startsWith(`${path}.`));

      if (existingNames.length > 0) {
        const { error: removeError } = await supabase.storage
          .from('teamlogos')
          .remove(existingNames);

        if (removeError) {
          throw removeError;
        }
      }

      const { error } = await supabase.storage
        .from('teamlogos')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/png', cacheControl: '3600' });

      if (error) {
        throw error;
      }

      const refreshStamp = Date.now();
      setLogoRefreshKeyByTeamId((prev) => ({
        ...prev,
        [team.id]: refreshStamp,
      }));
      localStorage.setItem(`teamlogo_refresh_${team.id}`, String(refreshStamp));
      window.dispatchEvent(
        new CustomEvent('teamlogo-updated', { detail: { teamId: team.id, version: refreshStamp } }),
      );
      setAvailableLogoPaths((prev) => {
        const nextPath = getLogoPath(team.id);
        const filtered = prev.filter((name) => !(name === nextPath || name.startsWith(`${nextPath}.`)));
        return [...filtered, nextPath];
      });
      setLogoStatusMessage(`Replaced logo for ${team.name} (${team.id.toUpperCase()}) in bucket "teamlogos".`);
    } catch (error) {
      console.error('Failed to upload team logo:', error);
      const reason = error instanceof Error ? error.message : 'Unknown upload error';
      setLogoStatusMessage(`Failed to upload logo for ${team.name}: ${reason}`);
    } finally {
      setUploadingTeamId(null);
    }
  };

  const handleEditLogoClick = (team: Team, hasExistingLogo: boolean) => {
    if (!isSupabaseEnabled) {
      setLogoStatusMessage('Supabase is not configured. Add your env keys first to edit logos.');
      return;
    }

    if (uploadingTeamId === team.id) {
      return;
    }

    const approved = window.confirm(
      hasExistingLogo
        ? `Replace the current logo for ${team.city} ${team.name}? The existing logo will be deleted before the new one is uploaded.`
        : `Upload a new logo for ${team.city} ${team.name}?`
    );
    if (!approved) {
      return;
    }

    const fileInput = document.getElementById(`logo-upload-${team.id}`) as HTMLInputElement | null;
    fileInput?.click();
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

  const groupedFilteredTeams = useMemo(() => (
    leagueOrder
      .map((league) => {
        const divisions = divisionOrder
          .map((division) => ({
            division,
            teams: filteredTeams.filter((team) => team.league === league && team.division === division),
          }))
          .filter((entry) => entry.teams.length > 0);

        return {
          league,
          divisions,
          teamCount: divisions.reduce((sum, entry) => sum + entry.teams.length, 0),
        };
      })
      .filter((entry) => entry.divisions.length > 0)
  ), [divisionOrder, filteredTeams, leagueOrder]);

  const leagueAccentText = (league: Team['league']) => (league === 'Prestige' ? 'text-prestige' : 'text-platinum');
  const leagueAccentBorder = (league: Team['league']) => (league === 'Prestige' ? 'border-l-prestige/70' : 'border-l-platinum/70');
  const previewPlayerIds = useMemo(
    () => new Set((playerGenerationPreview?.players ?? []).map((player) => player.playerId)),
    [playerGenerationPreview],
  );
  const previewBattingRatingsByPlayerId = useMemo(
    () => new Map((playerGenerationPreview?.battingRatings ?? []).map((ratings) => [ratings.playerId, ratings])),
    [playerGenerationPreview],
  );
  const previewPitchingRatingsByPlayerId = useMemo(
    () => new Map((playerGenerationPreview?.pitchingRatings ?? []).map((ratings) => [ratings.playerId, ratings])),
    [playerGenerationPreview],
  );
  const previewRosteredPlayerIds = useMemo(
    () => new Set((playerGenerationPreview?.rosterSlots ?? []).map((slot) => slot.playerId)),
    [playerGenerationPreview],
  );
  const previewPlayers = useMemo(
    () => (playerGenerationPreview?.players ?? []).slice(0, 12),
    [playerGenerationPreview],
  );
  const previewSeasonYear = useMemo(() => {
    const allYears = [
      ...(playerGenerationPreview?.battingRatings ?? []).map((ratings) => ratings.seasonYear),
      ...(playerGenerationPreview?.pitchingRatings ?? []).map((ratings) => ratings.seasonYear),
      ...(playerGenerationPreview?.rosterSlots ?? []).map((slot) => slot.seasonYear),
    ];
    return allYears.length > 0 ? Math.max(...allYears) : null;
  }, [playerGenerationPreview]);

  const handleClearHistoricalData = () => {
    const approved = window.confirm(
      'This will permanently delete all historical season runs and games from Supabase for this league. Current teams/settings stay intact. Continue?'
    );
    if (!approved) {
      return;
    }

    void onClearHistoricalData();
  };

  const handleHardWipePlayers = () => {
    const approved = window.confirm(
      'This will permanently delete every player, roster slot, and player stat row. No replacement pool will be generated automatically. Continue?'
    );
    if (!approved) {
      return;
    }

    void onHardWipePlayers();
  };

  const handleGeneratePlayers = () => {
    onPreviewGeneratePlayers();
  };

  const handleSaveSettings = () => {
    if (validationError) {
      return;
    }

    const settingsChanged = JSON.stringify(settings) !== JSON.stringify(initialSettings);
    if (settingsChanged) {
      const approved = window.confirm(
        'Saving these simulation settings will reset the current season schedule, standings, and season stats. Continue?'
      );
      if (!approved) {
        return;
      }
    }

    onSave(teams, settings);
  };

  const handleSaveSliderPreset = async () => {
    if (!isSupabaseEnabled) {
      setSliderPresetStatus('Supabase is not configured. Slider presets require Supabase.');
      return;
    }

    const trimmedName = sliderPresetName.trim();
    if (!trimmedName) {
      setSliderPresetStatus('Enter a preset name before saving.');
      return;
    }

    setIsSavingSliderPreset(true);
    setSliderPresetStatus(null);
    try {
      const savedPreset = await saveSupabaseSliderPreset(trimmedName, settings);
      setSliderPresets((prev) => [savedPreset, ...prev.filter((preset) => preset.id !== savedPreset.id && preset.presetName !== savedPreset.presetName)]);
      setSliderPresetName('');
      setSliderPresetStatus(`Saved slider preset "${savedPreset.presetName}".`);
    } catch (error) {
      console.error('Failed to save slider preset:', error);
      setSliderPresetStatus('Failed to save slider preset to Supabase.');
    } finally {
      setIsSavingSliderPreset(false);
    }
  };

  const handleDeleteSliderPreset = async (presetId: number) => {
    if (!isSupabaseEnabled) {
      return;
    }

    setDeletingSliderPresetId(presetId);
    setSliderPresetStatus(null);
    try {
      await deleteSupabaseSliderPreset(presetId);
      setSliderPresets((prev) => prev.filter((preset) => preset.id !== presetId));
      setSliderPresetStatus('Deleted slider preset.');
    } catch (error) {
      console.error('Failed to delete slider preset:', error);
      setSliderPresetStatus('Failed to delete slider preset.');
    } finally {
      setDeletingSliderPresetId(null);
    }
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
            onClick={handleSaveSettings}
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
      {sliderPresetStatus && (
        <div className="bg-white/5 border border-white/10 p-4 rounded-lg text-zinc-200">
          <span className="font-mono text-sm">{sliderPresetStatus}</span>
        </div>
      )}

      <div className="space-y-8">
        
        {/* Team Management */}
        <div className="bg-[#323232] rounded-xl border border-white/10 p-6">
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
          {!isSupabaseEnabled && (
            <p className="text-[11px] text-amber-300 font-mono mb-4">
              Logo uploads require Supabase storage configuration.
            </p>
          )}

          <div className="space-y-6 max-h-[680px] lg:max-h-[74vh] overflow-y-auto pr-2 custom-scrollbar">
            {groupedFilteredTeams.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-[#181818] px-4 py-6 text-center text-sm font-mono text-zinc-500">
                No teams matched your search.
              </div>
            ) : (
              groupedFilteredTeams.map((leagueGroup) => (
                <section key={leagueGroup.league} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <p className={`font-display text-xl uppercase tracking-[0.08em] ${leagueAccentText(leagueGroup.league)}`}>
                      {leagueGroup.league}
                    </p>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                      {leagueGroup.teamCount} teams
                    </span>
                    <div className={`h-px flex-1 ${leagueGroup.league === 'Prestige' ? 'bg-prestige/40' : 'bg-platinum/40'}`} />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    {leagueGroup.divisions.map((divisionGroup) => (
                      <article key={`${leagueGroup.league}-${divisionGroup.division}`} className="rounded-xl border border-white/10 bg-[#141414] p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                            {divisionGroup.division} Division
                          </p>
                          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                            {divisionGroup.teams.length}/4 clubs
                          </span>
                        </div>

                        <div className="space-y-3">
                          {divisionGroup.teams.map((team) => {
                            const logoPath = getLogoPath(team.id);
                            const hasLogo = availableLogoPaths.includes(logoPath);
                            const logoUrl = hasLogo ? getLogoUrl(team.id) : null;

                            return (
                              <div
                                key={team.id}
                                className={`grid grid-cols-1 md:grid-cols-6 gap-4 items-center bg-[#181818] p-3 rounded-lg border border-white/5 border-l-2 ${leagueAccentBorder(team.league)} hover:border-white/20 transition-colors`}
                              >
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
                                  <label className="text-[10px] uppercase text-slate-500 font-bold tracking-wider block mb-1">Edit Logo</label>
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-16 rounded-lg border border-white/15 p-1.5 flex items-center justify-center overflow-hidden shrink-0">
                                      {logoUrl ? (
                                        <img
                                          src={logoUrl}
                                          alt={`${team.name} logo`}
                                          className="w-full h-full object-contain scale-110"
                                        />
                                      ) : (
                                        <ImageIcon className="w-4 h-4 text-zinc-500" />
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleEditLogoClick(team, hasLogo)}
                                      disabled={uploadingTeamId === team.id || !isSupabaseEnabled}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/10 text-xs font-mono text-zinc-300 hover:text-white hover:border-white/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {uploadingTeamId === team.id ? 'Uploading...' : 'Edit Logo'}
                                    </button>
                                    <input
                                      id={`logo-upload-${team.id}`}
                                      type="file"
                                      accept="image/*"
                                      className="hidden"
                                      disabled={uploadingTeamId === team.id}
                                      onChange={(e) => {
                                        const nextFile = e.target.files?.[0] ?? null;
                                        void handleLogoUpload(team, nextFile);
                                        e.target.value = '';
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>

        {/* Simulation Tuning (moved below Team Management) */}
        <div className="space-y-6">
          <div className="bg-[#323232] rounded-xl border border-white/10 p-6">
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

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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

              <div className="space-y-3 lg:col-span-2">
                <div className="flex justify-between items-end gap-4">
                  <label className="font-display text-sm text-slate-300 uppercase tracking-wide">League Environment</label>
                  <span className="font-mono text-platinum text-sm">
                    {settings.leagueEnvironmentBalance < 0.45
                      ? 'Offense'
                      : settings.leagueEnvironmentBalance > 0.55
                        ? 'Pitching'
                        : 'Balanced'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.leagueEnvironmentBalance}
                  onChange={(e) => handleSettingChange('leagueEnvironmentBalance', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  <span>More offense</span>
                  <span>Balanced</span>
                  <span>More pitching</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Center is the neutral batting-average target for the league. Slide left for a hotter run environment and right for a lower-scoring, pitching-driven league.
                </p>
              </div>

              <div className="space-y-3 lg:col-span-2">
                <div className="flex justify-between items-end gap-4">
                  <label className="font-display text-sm text-slate-300 uppercase tracking-wide">Batting Average Variance</label>
                  <span className="font-mono text-platinum text-sm">
                    {settings.battingVarianceFactor < 0.35
                      ? 'Tight'
                      : settings.battingVarianceFactor > 0.65
                        ? 'Wide'
                        : 'Normal'}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.battingVarianceFactor}
                  onChange={(e) => handleSettingChange('battingVarianceFactor', parseFloat(e.target.value))}
                  className="w-full accent-platinum h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  <span>Compressed</span>
                  <span>Normal</span>
                  <span>Wider spread</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Controls how far hitters separate from the league mean. Lower values cluster averages together; higher values create more batting-title spikes and more weak-contact hitters.
                </p>
              </div>

              <div className="space-y-4 lg:col-span-2 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <label className="font-display text-sm text-slate-300 uppercase tracking-wide">Slider Presets</label>
                    <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                      Save the current slider setup to Supabase and reload it later.
                    </p>
                  </div>
                  {!isSupabaseEnabled && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">Supabase required</span>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    type="text"
                    value={sliderPresetName}
                    onChange={(e) => setSliderPresetName(e.target.value)}
                    placeholder="Preset name"
                    className="w-full rounded-lg border border-white/10 bg-[#181818] px-4 py-3 text-sm text-white outline-none focus:border-platinum font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveSliderPreset()}
                    disabled={!isSupabaseEnabled || isSavingSliderPreset}
                    className="rounded-lg bg-[#d4bb6a] px-5 py-3 font-display text-sm font-bold uppercase tracking-wide text-black disabled:bg-white/10 disabled:text-slate-500"
                  >
                    {isSavingSliderPreset ? 'Saving...' : 'Save Preset'}
                  </button>
                </div>

                <div className="space-y-3">
                  {sliderPresets.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-[#181818] px-4 py-4 text-sm font-mono text-zinc-500">
                      No slider presets saved yet.
                    </div>
                  ) : (
                    sliderPresets.map((preset) => (
                      <div key={preset.id} className="rounded-lg border border-white/10 bg-[#181818] px-4 py-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-display text-lg uppercase tracking-wide text-white">{preset.presetName}</p>
                            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                              Updated {new Date(preset.updatedAt).toLocaleDateString()}
                            </p>
                            <p className="mt-2 font-mono text-[11px] text-zinc-400">
                              Env {preset.settings.leagueEnvironmentBalance.toFixed(2)} | Var {preset.settings.battingVarianceFactor.toFixed(2)} | Luck {(preset.settings.gameLuckFactor * 100).toFixed(0)}%
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setSettings(preset.settings)}
                              className="rounded-lg border border-white/10 px-4 py-2 font-display text-sm uppercase tracking-wide text-white hover:border-white/20"
                            >
                              Apply
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteSliderPreset(preset.id)}
                              disabled={deletingSliderPresetId === preset.id}
                              className="rounded-lg border border-rose-500/25 px-4 py-2 font-display text-sm uppercase tracking-wide text-rose-300 hover:border-rose-400/40 disabled:opacity-50"
                            >
                              {deletingSliderPresetId === preset.id ? 'Deleting...' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* History Cleanup */}
              <div className="pt-4 border-t border-white/10 lg:col-span-2">
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
                  <button
                    onClick={handleGeneratePlayers}
                    disabled={isGeneratingPlayers}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-platinum/90 hover:bg-platinum disabled:bg-white/10 disabled:text-slate-500 text-black font-display font-bold tracking-wide uppercase rounded-lg transition-all shadow-lg active:scale-95"
                  >
                    <Users className="w-4 h-4" />
                    {isGeneratingPlayers ? 'Generating Players...' : 'Generate Players'}
                  </button>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Builds a fresh player pool with unique first-name and last-name combinations, then syncs it to the app state.
                  </p>
                  <button
                    onClick={handleHardWipePlayers}
                    disabled={isWipingPlayers}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 disabled:bg-white/10 disabled:text-slate-500 text-white font-display font-bold tracking-wide uppercase rounded-lg border border-white/15 transition-all shadow-lg active:scale-95"
                  >
                    <Trash2 className="w-4 h-4" />
                    {isWipingPlayers ? 'Wiping Players...' : 'Hard Wipe Players'}
                  </button>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Deletes the current player pool and leaves the player system empty until you seed it again.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {playerGenerationPreview && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-6xl rounded-3xl border border-white/10 bg-[#141414] shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Player Generation Preview</p>
                <h3 className="font-display text-3xl uppercase tracking-[0.12em] text-white mt-1">
                  {previewSeasonYear ? `Season ${previewSeasonYear}` : 'Generated Pool'}
                </h3>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onDismissPlayerPreview}
                  className="px-4 py-2 text-sm font-display uppercase tracking-[0.12em] text-zinc-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void onGeneratePlayers()}
                  disabled={isGeneratingPlayers}
                  className="flex items-center gap-2 rounded-xl bg-platinum px-5 py-2 text-sm font-display font-bold uppercase tracking-[0.12em] text-black disabled:bg-white/10 disabled:text-slate-500"
                >
                  <Users className="h-4 w-4" />
                  {isGeneratingPlayers ? 'Uploading...' : 'Generate & Upload'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 py-5 border-b border-white/10">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Players</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">{playerGenerationPreview.players.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Batters</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">{playerGenerationPreview.battingRatings.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Pitchers</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">{playerGenerationPreview.pitchingRatings.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Rostered</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">{previewRosteredPlayerIds.size}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Rated</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                  {previewPlayerIds.size === 0 ? 0 : previewBattingRatingsByPlayerId.size + previewPitchingRatingsByPlayerId.size}
                </p>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-6 py-5 scrollbar-subtle">
              <div className="rounded-2xl border border-white/10 overflow-hidden">
                <div className="grid grid-cols-[minmax(0,1.5fr)_80px_88px_90px_84px_84px_88px] gap-3 bg-white/5 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  <span>Player</span>
                  <span>Pos</span>
                  <span>Status</span>
                  <span>Team</span>
                  <span>OVR</span>
                  <span>POT</span>
                  <span>Age</span>
                </div>
                <div className="divide-y divide-white/5">
                  {previewPlayers.map((player) => {
                    const battingRatings = previewBattingRatingsByPlayerId.get(player.playerId);
                    const pitchingRatings = previewPitchingRatingsByPlayerId.get(player.playerId);
                    const overall = battingRatings?.overall ?? pitchingRatings?.overall ?? '---';
                    const potentialOverall = battingRatings?.potentialOverall ?? pitchingRatings?.potentialOverall ?? '---';
                    const team = player.teamId ? teams.find((candidate) => candidate.id === player.teamId) ?? null : null;

                    return (
                      <div key={player.playerId} className="grid grid-cols-[minmax(0,1.5fr)_80px_88px_90px_84px_84px_88px] gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-display text-xl uppercase tracking-[0.08em] text-white truncate">
                            {player.firstName} {player.lastName}
                          </p>
                          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500 truncate">
                            {player.playerType} | {player.bats}/{player.throws}
                          </p>
                        </div>
                        <span className="font-mono text-sm text-zinc-200">{player.primaryPosition}</span>
                        <span className="font-mono text-sm text-zinc-200">{player.status.replace('_', ' ')}</span>
                        <span className="font-mono text-sm text-zinc-200 truncate">{team ? team.city : 'None'}</span>
                        <span className="font-mono text-sm text-zinc-100">{overall}</span>
                        <span className="font-mono text-sm text-zinc-100">{potentialOverall}</span>
                        <span className="font-mono text-sm text-zinc-200">{player.age}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-4 font-mono text-[11px] text-zinc-500">
                Preview shows the first 12 generated players. Confirming will replace the current player pool and sync the full batch to Supabase.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
