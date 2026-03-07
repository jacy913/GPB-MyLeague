import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Move, Minus, Plus, RotateCcw } from 'lucide-react';
import { Team } from '../types';
import mapBackground from '../assets/glorestdarkmodewithnamesHD.png';
import { TeamLogo } from './TeamLogo';
import { TEAM_MAP_LOGO_POSITIONS, type MapTeamLogoPosition } from '../data/mapTeamLogoPositions';

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#121212,#202020,#0e0e0e)]';
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.12;
const DEFAULT_IMAGE_WIDTH = 1365;
const DEFAULT_IMAGE_HEIGHT = 768;
const MAP_MARKER_LAYOUT_STORAGE_KEY = 'gpb_map_marker_layout_v1';

type PanOffset = {
  x: number;
  y: number;
};

type DragState = {
  active: boolean;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

type MapImageBounds = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

type MarkerDragState = {
  active: boolean;
  teamId: string | null;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isMapTeamLogoPosition = (value: unknown): value is MapTeamLogoPosition =>
  Boolean(value) &&
  typeof value === 'object' &&
  isFiniteNumber((value as MapTeamLogoPosition).x) &&
  isFiniteNumber((value as MapTeamLogoPosition).y);

const parseStoredMarkerLayout = (raw: string | null): Record<string, MapTeamLogoPosition> => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, MapTeamLogoPosition>>((acc, [teamId, value]) => {
      if (!isMapTeamLogoPosition(value)) {
        return acc;
      }
      acc[teamId] = {
        x: clamp(value.x, 0, 100),
        y: clamp(value.y, 0, 100),
      };
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const computeContainBounds = (
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number,
): MapImageBounds => {
  if (viewportWidth <= 0 || viewportHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { width: 0, height: 0, offsetX: 0, offsetY: 0 };
  }

  const imageAspectRatio = imageWidth / imageHeight;
  const viewportAspectRatio = viewportWidth / viewportHeight;
  if (viewportAspectRatio > imageAspectRatio) {
    const height = viewportHeight;
    const width = height * imageAspectRatio;
    return {
      width,
      height,
      offsetX: (viewportWidth - width) / 2,
      offsetY: 0,
    };
  }

  const width = viewportWidth;
  const height = width / imageAspectRatio;
  return {
    width,
    height,
    offsetX: 0,
    offsetY: (viewportHeight - height) / 2,
  };
};

interface MapHubProps {
  teams: Team[];
}

export const MapHub: React.FC<MapHubProps> = ({ teams }) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const [isMarkerEditMode, setIsMarkerEditMode] = useState(false);
  const [markerOverrides, setMarkerOverrides] = useState<Record<string, MapTeamLogoPosition>>({});
  const [markerOverridesLoaded, setMarkerOverridesLoaded] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState<ViewportSize>({
    width: DEFAULT_IMAGE_WIDTH,
    height: DEFAULT_IMAGE_HEIGHT,
  });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState>({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const markerDragRef = useRef<MarkerDragState>({
    active: false,
    teamId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const mapImageBounds = useMemo(
    () =>
      computeContainBounds(
        viewportSize.width,
        viewportSize.height,
        imageSize.width,
        imageSize.height,
      ),
    [viewportSize.width, viewportSize.height, imageSize.width, imageSize.height],
  );

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => clamp(current + delta, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pan.x, pan.y]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (markerDragRef.current.active && markerDragRef.current.teamId) {
      if (mapImageBounds.width <= 0 || mapImageBounds.height <= 0) {
        return;
      }
      const deltaX = event.clientX - markerDragRef.current.startX;
      const deltaY = event.clientY - markerDragRef.current.startY;
      const nextX = clamp(markerDragRef.current.originX + (deltaX / mapImageBounds.width) * 100, 0, 100);
      const nextY = clamp(markerDragRef.current.originY + (deltaY / mapImageBounds.height) * 100, 0, 100);
      const draggingTeamId = markerDragRef.current.teamId;

      setMarkerOverrides((current) => ({
        ...current,
        [draggingTeamId]: { x: nextX, y: nextY },
      }));
      return;
    }

    if (!dragStateRef.current.active) {
      return;
    }

    const deltaX = event.clientX - dragStateRef.current.startX;
    const deltaY = event.clientY - dragStateRef.current.startY;
    setPan({
      x: dragStateRef.current.originX + deltaX,
      y: dragStateRef.current.originY + deltaY,
    });
  }, [mapImageBounds.height, mapImageBounds.width]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current.active = false;
    markerDragRef.current.active = false;
    markerDragRef.current.teamId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    adjustZoom(event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
  }, [adjustZoom]);

  const effectiveMarkerPositions = useMemo(
    () => ({
      ...TEAM_MAP_LOGO_POSITIONS,
      ...markerOverrides,
    }),
    [markerOverrides],
  );

  const handleMarkerPointerDown = useCallback((
    teamId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!isMarkerEditMode) {
      return;
    }
    const position = effectiveMarkerPositions[teamId];
    if (!position) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    markerDragRef.current = {
      active: true,
      teamId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [effectiveMarkerPositions, isMarkerEditMode]);

  const handleMarkerPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMarkerEditMode || !markerDragRef.current.active || !markerDragRef.current.teamId) {
      return;
    }
    if (mapImageBounds.width <= 0 || mapImageBounds.height <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const deltaX = event.clientX - markerDragRef.current.startX;
    const deltaY = event.clientY - markerDragRef.current.startY;
    const nextX = clamp(markerDragRef.current.originX + (deltaX / mapImageBounds.width) * 100, 0, 100);
    const nextY = clamp(markerDragRef.current.originY + (deltaY / mapImageBounds.height) * 100, 0, 100);
    const draggingTeamId = markerDragRef.current.teamId;

    setMarkerOverrides((current) => ({
      ...current,
      [draggingTeamId]: { x: nextX, y: nextY },
    }));
  }, [isMarkerEditMode, mapImageBounds.height, mapImageBounds.width]);

  const handleMarkerPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!markerDragRef.current.active) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    markerDragRef.current.active = false;
    markerDragRef.current.teamId = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const resetMarkerLayout = useCallback(() => {
    setMarkerOverrides({});
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }

    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateViewportSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateViewportSize());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const raw = window.localStorage.getItem(MAP_MARKER_LAYOUT_STORAGE_KEY);
    setMarkerOverrides(parseStoredMarkerLayout(raw));
    setMarkerOverridesLoaded(true);
  }, []);

  useEffect(() => {
    if (!markerOverridesLoaded || typeof window === 'undefined') {
      return;
    }

    const timeout = window.setTimeout(() => {
      if (Object.keys(markerOverrides).length === 0) {
        window.localStorage.removeItem(MAP_MARKER_LAYOUT_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(MAP_MARKER_LAYOUT_STORAGE_KEY, JSON.stringify(markerOverrides));
    }, 120);

    return () => window.clearTimeout(timeout);
  }, [markerOverrides, markerOverridesLoaded]);

  const positionedTeams = useMemo(
    () =>
      teams
        .filter((team) => Boolean(effectiveMarkerPositions[team.id]))
        .map((team) => ({
          team,
          position: effectiveMarkerPositions[team.id],
        })),
    [effectiveMarkerPositions, teams],
  );

  return (
    <section className="space-y-6">
      <article className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">World Atlas</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Map</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Explore Glorest. Drag to pan and use mouse wheel or controls to zoom.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => adjustZoom(ZOOM_STEP)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-200 hover:border-white/20"
            >
              <Plus className="h-4 w-4" />
              Zoom In
            </button>
            <button
              type="button"
              onClick={() => adjustZoom(-ZOOM_STEP)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-200 hover:border-white/20"
            >
              <Minus className="h-4 w-4" />
              Zoom Out
            </button>
            <button
              type="button"
              onClick={resetView}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-200 hover:border-white/20"
            >
              <RotateCcw className="h-4 w-4" />
              Reset View
            </button>
            <button
              type="button"
              onClick={() => setIsMarkerEditMode((current) => !current)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] transition-colors ${
                isMarkerEditMode
                  ? 'border-[#d4bb6a]/45 bg-[#d4bb6a]/15 text-[#f3dea1] hover:border-[#d4bb6a]/65'
                  : 'border-white/10 bg-black/25 text-zinc-200 hover:border-white/20'
              }`}
            >
              {isMarkerEditMode ? 'Exit Marker Edit' : 'Marker Edit Mode'}
            </button>
            <button
              type="button"
              onClick={resetMarkerLayout}
              disabled={Object.keys(markerOverrides).length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-200 hover:border-white/20 disabled:opacity-50"
            >
              Reset Marker Layout
            </button>
          </div>
        </div>
        {isMarkerEditMode && (
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[#d4bb6a]">
            Marker edit mode enabled. Drag logos to align with cities. Layout auto-saves locally.
          </p>
        )}
      </article>

      <article className={`${sectionClass} p-4`}>
        <div
          ref={viewportRef}
          className="relative h-[72vh] overflow-hidden overscroll-contain rounded-2xl border border-white/10 bg-[#132a63] cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheelCapture={handleWheel}
        >
          <div className="pointer-events-none absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-300">
            <Move className="h-3.5 w-3.5" />
            Drag to Pan
          </div>
          <div className="pointer-events-none absolute right-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-300">
            <Crosshair className="h-3.5 w-3.5" />
            {Math.round(zoom * 100)}%
          </div>

          <div
            className="absolute left-1/2 top-1/2 h-full w-full"
            style={{
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          >
            <img
              src={mapBackground}
              alt="Glorest world map"
              draggable={false}
              className="h-full w-full select-none object-contain"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setImageSize({
                    width: naturalWidth,
                    height: naturalHeight,
                  });
                }
              }}
            />
            <div className={`${isMarkerEditMode ? '' : 'pointer-events-none'} absolute inset-0`}>
              {positionedTeams.map(({ team, position }) => {
                const left = mapImageBounds.offsetX + (position.x / 100) * mapImageBounds.width;
                const top = mapImageBounds.offsetY + (position.y / 100) * mapImageBounds.height;

                return (
                  <div
                    key={team.id}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 ${isMarkerEditMode ? 'cursor-move pointer-events-auto' : 'pointer-events-none'}`}
                    style={{ left, top }}
                    title={`${team.city} ${team.name}`}
                    onPointerDown={(event) => handleMarkerPointerDown(team.id, event)}
                    onPointerMove={handleMarkerPointerMove}
                    onPointerUp={handleMarkerPointerUp}
                    onPointerCancel={handleMarkerPointerUp}
                  >
                    <div className={`rounded-full border bg-black/45 p-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.55)] transition-colors ${isMarkerEditMode ? 'border-[#d4bb6a]/80' : 'border-white/35'}`}>
                      <TeamLogo team={team} sizeClass="h-6 w-6" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </article>
    </section>
  );
};
