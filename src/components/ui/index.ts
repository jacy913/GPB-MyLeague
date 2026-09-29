/**
 * GPB MyLeague Design System — Primitive Library
 *
 * All components reference tokens from src/index.css only.
 * No raw hex, no arbitrary values, no large radii, no font-mono.
 */

export { Panel, type PanelVariant } from './Panel';
export { PanelHeader, type PanelHeaderVariant } from './PanelHeader';
export { SkewedPanel, type SkewDirection } from './SkewedPanel';
export { SkewedTab, type SkewedTabVariant, type SkewedTabDirection } from './SkewedTab';
export { RetroButton, type RetroButtonVariant, type RetroButtonSize } from './RetroButton';
export { SegmentedControl, type SegmentedControlMode } from './SegmentedControl';
export { StatTable, type StatTableDensity, type StatTableColumn, type StatTableRow } from './StatTable';
export { StatValue, type StatValueVariant, type StatValueSize } from './StatValue';
export { Meter, type MeterProps } from './Meter';
export { LeagueBadge, type LeagueBadgeVariant } from './LeagueBadge';
export { SectionTitle, type SectionTitleProps } from './SectionTitle';

// TeamLogo is deliberately absent. §9.2 moves the existing
// src/components/TeamLogo.tsx into this directory during Phase 3.2, but that
// file owns real asset resolution -- import.meta.glob over src/assets/cured
// logos, a Supabase storage fallback, cache-busting, and a teamlogo-updated
// event listener. A plate-only primitive here would have to fabricate a URL
// path that does not exist, because the assets are bundled through the glob
// rather than served from public/. It is added when the resolver moves with it.