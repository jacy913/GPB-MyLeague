import React, { useEffect, useMemo, useState } from 'react';
import { Team } from '../types';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

interface TeamLogoProps {
  team: Team;
  sizeClass?: string;
}

const LOCAL_LOGO_NAME_BY_TEAM_ID: Record<string, string> = {
  hui: 'Huider Shepherds',
};
const LOCAL_LOGO_MODULES = import.meta.glob('../assets/cured logos/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;
const normalizeLogoKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');
const LOCAL_LOGO_URL_BY_KEY = new Map<string, string>(
  Object.entries(LOCAL_LOGO_MODULES)
    .map(([modulePath, moduleUrl]) => {
      const fileName = modulePath.split('/').pop() ?? '';
      const baseName = fileName.replace(/\.png$/i, '');
      return [normalizeLogoKey(baseName), moduleUrl] as const;
    }),
);
const TEAM_LOGO_BASE_URL_CACHE = new Map<string, string | null>();
const LOCAL_TEAM_LOGO_URL_CACHE = new Map<string, string | null>();

const getLocalTeamLogoUrl = (team: Team): string | null => {
  if (LOCAL_TEAM_LOGO_URL_CACHE.has(team.id)) {
    return LOCAL_TEAM_LOGO_URL_CACHE.get(team.id) ?? null;
  }

  const candidates = [
    LOCAL_LOGO_NAME_BY_TEAM_ID[team.id],
    `${team.city} ${team.name}`,
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    const matched = LOCAL_LOGO_URL_BY_KEY.get(normalizeLogoKey(candidate));
    if (matched) {
      LOCAL_TEAM_LOGO_URL_CACHE.set(team.id, matched);
      return matched;
    }
  }

  LOCAL_TEAM_LOGO_URL_CACHE.set(team.id, null);
  return null;
};

const getTeamLogoBaseUrl = (teamId: string): string | null => {
  if (TEAM_LOGO_BASE_URL_CACHE.has(teamId)) {
    return TEAM_LOGO_BASE_URL_CACHE.get(teamId) ?? null;
  }

  if (!isSupabaseConfigured || !supabase) {
    TEAM_LOGO_BASE_URL_CACHE.set(teamId, null);
    return null;
  }

  const path = teamId.trim().toLowerCase();
  const { data } = supabase.storage.from('teamlogos').getPublicUrl(path);
  TEAM_LOGO_BASE_URL_CACHE.set(teamId, data.publicUrl);
  return data.publicUrl;
};

const TeamLogoComponent: React.FC<TeamLogoProps> = ({ team, sizeClass = 'w-10 h-10' }) => {
  const [logoFailed, setLogoFailed] = useState(false);
  const [cacheVersion, setCacheVersion] = useState<number | null>(null);
  const localLogoUrl = useMemo(() => getLocalTeamLogoUrl(team), [team]);
  const logoUrl = useMemo(() => {
    if (localLogoUrl) {
      return localLogoUrl;
    }

    const baseUrl = getTeamLogoBaseUrl(team.id);
    if (!baseUrl) {
      return null;
    }
    return cacheVersion ? `${baseUrl}?v=${cacheVersion}` : baseUrl;
  }, [cacheVersion, localLogoUrl, team.id]);

  useEffect(() => {
    setLogoFailed(false);
    if (localLogoUrl) {
      setCacheVersion(null);
      return;
    }

    const stored = localStorage.getItem(`teamlogo_refresh_${team.id}`);
    if (stored) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed) && parsed > 0) {
        setCacheVersion(parsed);
        return;
      }
    }
    setCacheVersion(null);
  }, [localLogoUrl, team.id]);

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

export const TeamLogo = React.memo(
  TeamLogoComponent,
  (prev, next) => prev.team.id === next.team.id && prev.sizeClass === next.sizeClass,
);
