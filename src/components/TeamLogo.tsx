import React, { useEffect, useMemo, useState } from 'react';
import { Team } from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

interface TeamLogoProps {
  team: Team;
  sizeClass?: string;
}

const LOGO_CACHE_BUSTER = Date.now();

const getTeamLogoUrl = (teamId: string, version: number): string | null => {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const path = teamId.trim().toLowerCase();
  const { data } = supabase.storage.from('teamlogos').getPublicUrl(path);
  return `${data.publicUrl}?v=${version}`;
};

export const TeamLogo: React.FC<TeamLogoProps> = ({ team, sizeClass = 'w-10 h-10' }) => {
  const [logoFailed, setLogoFailed] = useState(false);
  const [cacheVersion, setCacheVersion] = useState<number>(LOGO_CACHE_BUSTER);
  const logoUrl = useMemo(() => getTeamLogoUrl(team.id, cacheVersion), [team.id, cacheVersion]);

  useEffect(() => {
    setLogoFailed(false);
    const stored = localStorage.getItem(`teamlogo_refresh_${team.id}`);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed > 0) {
        setCacheVersion(parsed);
        return;
      }
    }
    setCacheVersion(LOGO_CACHE_BUSTER);
  }, [team.id]);

  useEffect(() => {
    const handleLogoUpdated = (event: Event) => {
      const custom = event as CustomEvent<{ teamId?: string; version?: number }>;
      const eventTeamId = custom.detail?.teamId;
      const eventVersion = custom.detail?.version;
      if (eventTeamId === team.id && typeof eventVersion === 'number') {
        setCacheVersion(eventVersion);
        setLogoFailed(false);
      }
    };

    window.addEventListener('teamlogo-updated', handleLogoUpdated as EventListener);
    return () => window.removeEventListener('teamlogo-updated', handleLogoUpdated as EventListener);
  }, [team.id]);

  return (
    <div className={`${sizeClass} rounded-md bg-transparent overflow-hidden shrink-0 flex items-center justify-center`}>
      {logoUrl && !logoFailed ? (
        <img
          src={logoUrl}
          alt={`${team.name} logo`}
          className="w-full h-full object-contain"
          onError={() => setLogoFailed(true)}
        />
      ) : (
        <span className="text-[10px] font-mono uppercase text-zinc-400">{team.id.slice(0, 3)}</span>
      )}
    </div>
  );
};
