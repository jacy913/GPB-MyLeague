import React, { useState } from 'react';
import type { AppView } from '../types';
import { FolderNav } from '../navigation/FolderNav';
import { MobileFolderMenu } from '../navigation/MobileFolderMenu';
import {
  LeagueBadge,
  Meter,
  Panel,
  PanelHeader,
  RetroButton,
  SectionTitle,
  SegmentedControl,
  SkewedPanel,
  SkewedTab,
  StatTable,
  StatValue,
} from './ui';

/** Development-only visual review route for every design-system primitive. */
export const UiKitGallery: React.FC = () => {
  const [segment, setSegment] = useState('season');
  const [activeTab, setActiveTab] = useState<'overview' | 'stats'>('overview');
  const [galleryView, setGalleryView] = useState<AppView>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <section className="space-y-6">
      <SectionTitle secondary="DEVELOPMENT ROUTE">UI Kit Gallery</SectionTitle>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-4 space-y-4">
          <PanelHeader title="Panels & headers" secondary="CHROME BAR" />
          <Panel variant="sunken" className="p-4 t-body text-[var(--color-ink-dim)]">Sunken content well</Panel>
          <Panel variant="hero" className="p-4"><StatValue size="lg" variant="accent">72–54</StatValue></Panel>
          <SkewedPanel direction="notch-tr"><p className="t-body text-[var(--color-ink)]">Skewed panel</p></SkewedPanel>
        </Panel>

        <Panel className="p-4 space-y-4">
          <PanelHeader title="Controls" secondary="INTERACTIVE" />
          <div className="flex flex-wrap gap-3">
            <RetroButton variant="primary">Primary</RetroButton>
            <RetroButton>Default</RetroButton>
            <RetroButton variant="ghost">Ghost</RetroButton>
            <RetroButton variant="danger">Danger</RetroButton>
          </div>
          <div className="flex gap-2">
            {(['overview', 'stats'] as const).map((tab) => (
              <SkewedTab key={tab} variant={activeTab === tab ? 'active' : 'inactive'} onClick={() => setActiveTab(tab)}>{tab}</SkewedTab>
            ))}
          </div>
          <SegmentedControl
            aria-label="Gallery range"
            mode="fill"
            value={segment}
            onChange={setSegment}
            options={[{ value: 'season', label: 'Season' }, { value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]}
          />
        </Panel>

        <Panel className="p-4 space-y-4">
          <PanelHeader title="Figures & meters" secondary="TABULAR NUMS" />
          <div className="flex flex-wrap items-center gap-4">
            <StatValue>.318</StatValue><StatValue variant="accent">34 HR</StatValue><StatValue variant="pos">+38</StatValue><StatValue variant="neg">-12</StatValue>
          </div>
          <Meter value={72} showValue aria-label="Season progress" />
          <div className="flex flex-wrap gap-2"><LeagueBadge variant="prestige" /><LeagueBadge variant="platinum" /></div>
        </Panel>

        <Panel className="p-4 space-y-4">
          <PanelHeader title="Stat table" secondary="SORT STATE" />
          <StatTable
            aria-label="Gallery standings"
            sortColumn="pct"
            columns={[{ key: 'team', header: 'TEAM' }, { key: 'record', header: 'W–L', align: 'right', isNumeric: true, width: '6ch' }, { key: 'pct', header: 'PCT', align: 'right', isNumeric: true, sortKey: 'pct', width: '5ch' }]}
            rows={[{ id: 'a', cells: { team: 'Aubagne Vipers', record: '72–54', pct: '.571' }, highlight: true }, { id: 'b', cells: { team: 'Arabay Marines', record: '68–58', pct: '.540' } }]}
          />
        </Panel>

        <Panel className="p-4 space-y-4 xl:col-span-2">
          <PanelHeader title="Folder navigation" secondary="DESKTOP FIXTURE" />
          <FolderNav view={galleryView} onSetView={setGalleryView} className="!block !h-[400px]" />
          <RetroButton onClick={() => setIsMobileMenuOpen(true)}>Open mobile menu</RetroButton>
        </Panel>
      </div>
      <MobileFolderMenu
        isOpen={isMobileMenuOpen}
        view={galleryView}
        onSetView={setGalleryView}
        onClose={() => setIsMobileMenuOpen(false)}
      />
    </section>
  );
};
