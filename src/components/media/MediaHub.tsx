import React, { useMemo, useState } from 'react';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID, MEDIA_PROFILES } from '../../data/media';
import { buildMediaReads } from '../../lib/mediaReads';
import type { MediaReadInput } from '../../lib/mediaReads';
import { Panel } from '../ui';
import { MediaCards, MediaMethodPanel, MediaVoicePanel } from './MediaCard';
import { MediaDataPanels } from './MediaTables';

/**
 * The Media.
 *
 * Three forecasters, each with a live read on all thirty-two clubs, and the
 * table showing where the three disagree. There is deliberately no track record
 * here: nothing has been predicted yet, so any accuracy figure would be
 * invented. What is shown instead is the basis of each read -- the actual
 * weights -- which is auditable, plus each outlet's stated weakness, which is
 * what a manager needs in order to know when to believe it and when to fade it.
 *
 * The odds layer will sit on top of this rather than beside it. A read across a
 * league is the same computation as a read between two clubs, narrowed, so this
 * is the forecaster the betting work will present rather than a parallel model
 * that could disagree with it.
 */
export const MediaHub: React.FC<MediaReadInput> = (input) => {
  const [selectedId, setSelectedId] = useState<MediaId>('hollis');
  const profile = MEDIA_BY_ID[selectedId];

  const { reads, disagreements } = useMemo(() => buildMediaReads(input), [input]);

  const hasSeasonOutput = input.teams.some((team) => team.wins + team.losses > 0);

  return (
    <section className="space-y-5">
      <Panel variant="hero" className="p-4 md:p-5">
        <h1 className="t-h1">The Media</h1>
        <p className="t-body mt-2 max-w-3xl text-[var(--color-ink-dim)]">
          Three outlets read the same league three different ways, and none of them is adjusted for
          the others. What they disagree about is the interesting part.
        </p>
        {!hasSeasonOutput && (
          <p className="t-caption mt-3 border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2 text-[var(--color-warn)]">
            No season has been played yet. Glorest Press has nothing observed to read, so it is
            currently rating the field on pre-season ratings rather than on results.
          </p>
        )}
      </Panel>

      <MediaCards selectedId={selectedId} onSelect={setSelectedId} />

      <Panel className="overflow-hidden">
        <div
          className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4"
          style={{ borderLeft: `3px solid var(--color-media-${profile.accent})` }}
        >
          <div className="min-w-0">
            <h2 className="t-h3" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
              {profile.name}
            </h2>
          </div>
          <span className="t-caption text-[var(--color-ink-faint)]">
            {MEDIA_PROFILES.findIndex((entry) => entry.id === selectedId) + 1} of {MEDIA_PROFILES.length}
          </span>
        </div>
        <div className="flex flex-col gap-5 p-4">
          <MediaMethodPanel profile={profile} />
          <div>
            <p className="t-label mb-2 text-[var(--color-ink-faint)]">In their own words</p>
            <MediaVoicePanel profile={profile} />
          </div>
        </div>
      </Panel>

      <MediaDataPanels read={reads[selectedId]} profile={profile} disagreements={disagreements} />
    </section>
  );
};
