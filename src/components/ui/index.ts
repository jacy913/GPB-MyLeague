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
export { MediaMark, type MediaMarkProps } from './MediaMark';
export { SectionTitle, type SectionTitleProps } from './SectionTitle';

/**
 * TeamLogo moved here in Phase 3.2 with its asset resolution intact -- the
 * import.meta.glob over src/assets/cured logos, the Supabase storage fallback,
 * cache-busting, and the teamlogo-updated listener. An earlier plate-only
 * primitive here was removed precisely because it could not resolve an image
 * path: there is no public/ directory, the assets are bundled through the glob.
 * The chrome plate travels with the resolver or not at all.
 */
export { TeamLogo, type TeamLogoProps } from './TeamLogo';
export { OddsBar, type OddsBarProps } from './OddsBar';
export { MatchupStrip, type MatchupStripProps } from './MatchupStrip';
export { RatingRing, type RatingRingProps } from './RatingRing';
export {
  Chevron, ChevronEdge, StripeDivider, ParallelogramTitle,
  type ChevronProps,
} from './Chevron';
export type { StripeDividerProps, ParallelogramTitleProps, ChevronEdgeProps } from './Chevron';