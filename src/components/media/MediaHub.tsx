import React, { useMemo, useState } from 'react';
import { BarChart3, Users } from 'lucide-react';
import type { Game } from '../../types';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID } from '../../data/media';
import { buildMediaReads, type MediaReadInput } from '../../lib/mediaReads';
import { buildGameLine, getNextSlateDate, HOUSE_MARGIN, type GameLine } from '../../lib/mediaOdds';
import { Panel, SegmentedControl } from '../ui';
import { MediaCards, MediaMethodPanel, MediaVoicePanel } from './MediaCard';
import { MediaDisagreementTable, MediaRanking } from './MediaTables';
import { MediaOddsSlate } from './MediaOddsSlate';

interface MediaHubProps extends MediaReadInput {
  games: Game[];
  currentDate: string;
}

/**
 * The Media.
 *
 * Three forecasters, each with a live read on all thirty-two clubs, the prices
 * they are posting for the next slate, and the table showing where the three
 * cannot agree.
 *
 * The two club tables are one surface with a switcher rather than two stacked.
 * Thirty-two rows twice is the entire page twice over, and the two views answer
 * different questions about the same data: one asks what a single outlet thinks,
 * the other asks where the three part company. Choosing between them by position
 * on the page forces a scroll to answer either.
 *
 * There is deliberately no track record. Nothing has settled yet, so any
 * accuracy figure would be invented. What is shown is the basis of each read --
 * the actual weights -- which is auditable, and each outlet's stated weakness,
 * which is what a manager needs in order to know when to believe it and when to
 * fade it. Brier score arrives free once settlement exists.
 */
export const MediaHub: React.FC<MediaHubProps> = ({ games, currentDate, ...input }) => {
  const [selectedId, setSelectedId] = useState<MediaId>('hollis');
  const [tableView, setTableView] = useState<'read' | 'split'>('split');
  const profile = MEDIA_BY_ID[selectedId];

  const readInput = input as MediaReadInput;
  const { reads, scores, spread, disagreements } = useMemo(() => buildMediaReads(readInput), [readInput]);

  const slateDate = useMemo(() => getNextSlateDate(games, currentDate), [currentDate, games]);

  const lines = useMemo<GameLine[]>(() => {
    if (!slateDate) return [];
    return games
      .filter((game) => game.date === slateDate)
      .map((game) => {
        const away = input.teams.find((team) => team.id === game.awayTeam);
        const home = input.teams.find((team) => team.id === game.homeTeam);
        if (!away || !home) return null;
        const scoreFor = (teamId: string) => ({
          hollis: scores.hollis.get(teamId) ?? 0.5,
          glorest: scores.glorest.get(teamId) ?? 0.5,
          sharply: scores.sharply.get(teamId) ?? 0.5,
        });
        return buildGameLine({ game, away, home, awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread });
      })
      .filter((line): line is GameLine => line !== null)
      .sort((a, b) => a.awayTeam.city.localeCompare(b.awayTeam.city));
  }, [games, input.teams, scores, slateDate, spread]);

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
          <h2 className="t-h3" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
            {profile.name}
          </h2>
          <span className="t-caption text-[var(--color-ink-faint)]">
            {profile.outlet} · {profile.role}
          </span>
        </div>
        <div className="flex flex-col gap-5 p-4">
          <p className="t-body max-w-3xl text-[var(--color-ink-dim)]">{profile.thesis}</p>
          <MediaMethodPanel profile={profile} />
          <div>
            <p className="t-label mb-2 text-[var(--color-ink-faint)]">In their own words</p>
            <MediaVoicePanel profile={profile} />
          </div>
        </div>
      </Panel>

      <MediaOddsSlate lines={lines} slateDate={slateDate} />

      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            {tableView === 'split'
              ? <BarChart3 className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
              : <Users className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />}
            <h2 className="t-h3">
              {tableView === 'split' ? 'Where They Disagree' : `${profile.outlet} Club Ranking`}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="t-caption text-[var(--color-ink-faint)]">
              {tableView === 'split' ? 'All three, sortable' : `${reads[selectedId].rows.length} clubs`}
            </span>
            <SegmentedControl
              aria-label="Club table"
              mode="fill"
              value={tableView}
              onChange={(value) => setTableView(value as 'read' | 'split')}
              options={[
                { value: 'split', label: 'Comparison' },
                { value: 'read', label: profile.outlet },
              ]}
            />
          </div>
        </div>
        <div className="p-2">
          {tableView === 'split'
            ? <MediaDisagreementTable rows={disagreements} />
            : <MediaRanking read={reads[selectedId]} profile={profile} />}
        </div>
      </Panel>

      <p className="t-caption px-1 text-[var(--color-ink-faint)]">
        The house line shown above is the mean of the three posted probabilities with a{' '}
        {Math.round(HOUSE_MARGIN * 100)}% margin, not the mean of the three prices. Nothing is
        wagered here yet; these are the numbers the betting layer will read.
      </p>
    </section>
  );
};
