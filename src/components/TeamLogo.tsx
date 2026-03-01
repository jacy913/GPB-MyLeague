import React, { useEffect, useMemo, useState } from 'react';
import { Team } from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

interface TeamLogoProps {
  team: Team;
  sizeClass?: string;
}

const LOGO_CACHE_BUSTER = Date.now();

const getTeamLogoUrl = (teamId: string): string | null => {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const path = teamId.trim().toLowerCase();
  const { data } = supabase.storage.from('teamlogos').getPublicUrl(path);
  return `${data.publicUrl}?v=${LOGO_CACHE_BUSTER}`;
};

export const TeamLogo: React.FC<TeamLogoProps> = ({ team, sizeClass = 'w-10 h-10' }) => {
  const [logoFailed, setLogoFailed] = useState(false);
  const logoUrl = useMemo(() => getTeamLogoUrl(team.id), [team.id]);

  useEffect(() => {
    setLogoFailed(false);
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
