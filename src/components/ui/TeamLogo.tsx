import React, { useEffect, useMemo, useState } from 'react';
import { Team } from '../../types';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';

export interface TeamLogoProps {
  team: Team;
  sizeClass?: string;
  /**
   * Draw the chrome well behind the logo. Off by default.
   *
   * The plate was added because the logos were cut against a neutral dark field
   * and could lose edge contrast on navy. On review it read as a dark blue box
   * around every crest, which was worse than the contrast problem it solved, and
   * it competed with the mark instead of presenting it. Re-enable per call site
   * if a specific logo does fringe against a particular surface.
   */
  plate?: boolean;
  /**
   * Defer decoding until the image is near the viewport.
   *
   * NOT the default, and the reason is worth stating: `loading="lazy"` on a crest that is already
   * on screen costs a visible pop-in for no saving, and most call sites here are above the fold.
   *
   * It exists for the one caller that renders THIRTY-TWO of these at once at 400px. The library is
   * super-HD -- the sources run from 500px to 5016px square -- and a single 5016px PNG decodes to
   * roughly 100 MB of bitmap. Thirty-two of them eagerly decoded is a tab that dies, not a page
   * that is slow. Lazy keeps only the visible tiles resident.
   */
  lazy?: boolean;
}

/*
 * Asset resolution below is carried over unchanged from the previous
 * src/components/TeamLogo.tsx. It is not presentational: the import.meta.glob
 * is what makes the 32 bundled logos addressable at all (there is no public/
 * directory), the Supabase branch is the fallback for user-uploaded logos, and
 * the event listener is how a freshly uploaded logo invalidates its cache.
 * Moving the file relocates that logic; it does not rewrite it.
 *
 * An earlier attempt at a plate-only primitive in this directory had to invent
 * a URL path for the images, which does not exist. The plate travels with the
 * resolver or not at all.
 */

const LOCAL_LOGO_NAME_BY_TEAM_ID: Record<string, string> = {
  hui: 'Huider Shepherds',
};
const LOCAL_LOGO_MODULES = import.meta.glob('../../assets/cured logos/*.png', {
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

const TeamLogoComponent: React.FC<TeamLogoProps> = ({ team, sizeClass = 'w-10 h-10', plate = false, lazy = false }) => {
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
    <div
      className={`${sizeClass} shrink-0 overflow-hidden ${plate ? 'p-[3px]' : ''}`}
      style={plate ? {
        background: 'linear-gradient(180deg, var(--color-panel-2), var(--color-base-2))',
        border: '1px solid var(--color-chrome-lo)',
        borderRadius: 'var(--radius-panel)',
      } : undefined}
    >
      {logoUrl && !logoFailed ? (
        <img
          src={logoUrl}
          alt={`${team.name} logo`}
          className="h-full w-full object-contain"
          loading={lazy ? 'lazy' : undefined}
          decoding={lazy ? 'async' : undefined}
          onError={() => setLogoFailed(true)}
        />
      ) : (
        // Fallback crest. Sized in absolute terms because sizeClass is an
        // opaque Tailwind string and call sites span h-4 through h-40; it
        // clips in the smallest slots rather than overflowing them. Not a
        // figure the user compares, so it sits below the 12px stat floor.
        <div
          className="flex h-full w-full items-center justify-center overflow-hidden text-[0.75rem] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]"
          aria-label={team.name}
        >
          {team.id.slice(0, 3)}
        </div>
      )}
    </div>
  );
};

export const TeamLogo = React.memo(
  TeamLogoComponent,
  (prev, next) => prev.team.id === next.team.id
    && prev.sizeClass === next.sizeClass
    && prev.plate === next.plate
    && prev.lazy === next.lazy,
);
