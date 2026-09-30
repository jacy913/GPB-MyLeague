import React from 'react';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID } from '../../data/media';
import type { GameLine } from '../../lib/mediaOdds';
import { formatAmerican } from '../../lib/mediaOdds';
import { MEDIA_IMAGES, MEDIA_MARKS } from './mediaImages';
import { MediaPropBoard } from './MediaPropCards';
import { MediaMethodPanel, MediaVoicePanel } from './MediaCard';
import type { PropMarket } from '../../lib/playerProps';
import { Modal, TeamLogo } from '../ui';

/**
 * The details popup.
 *
 * Opens from the "details" control on a forecaster's card and carries that
 * outlet's logo, its published moneyline lines, and its five props, laid out the
 * way a betting site lays out a market: game headers, then a grid of cards.
 *
 * The logo leads because the popup is reached from a card that already names the
 * outlet. Its presence is not redundancy -- it is the thing that makes the popup
 * usable once it is on top of everything else. A panel of nine prices with no
 * attribution is a list of numbers; with the masthead it is a claim, and the
 * manager can see at a glance whose opinion they are reading before they act on
 * it. The three outlets are deliberately distinguishable by logo and colour
 * rather than by name, so recognition does not require reading.
 *
 * Moneylines and props share this one popup rather than getting one each. A
 * manager choosing where to put money on a night is choosing between a game and
 * its players, and splitting those across two dialogs would make them dismiss one
 * to consult the other and remember the price. The moneylines stay exactly as
 * they are published on the slate -- same prices, same disagreement figure --
 * so nothing here restates a number the slate already shows in a different form.
 */
export const MediaDetailsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  mediaId: MediaId;
  lines: GameLine[];
  props: PropMarket[];
  slateDate: string | null;
  matchupLabel: (gameId: string) => string;
  teamCity: (teamId: string) => string;
  onOpenProp: (propId: string, mediaId: MediaId) => void;
  onGoToBetting: () => void;
}> = ({
  isOpen, onClose, mediaId, lines, props, slateDate, matchupLabel, teamCity, onOpenProp, onGoToBetting,
}) => {
  const profile = MEDIA_BY_ID[mediaId];
  const image = MEDIA_IMAGES[mediaId];

  const safeCount = props.filter((market) => market.temperament[mediaId] === 'safe').length;
  const hotCount = props.length - safeCount;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      accent={profile.accent}
      widthClass="max-w-5xl"
      title={profile.outlet}
      barRight={(
        <span className="t-caption text-[var(--color-ink-faint)]">
          {props.length > 0
            ? `${props.length} props · ${safeCount} safe · ${hotCount} hot`
            : lines.length > 0 ? `${lines.length} lines` : 'nothing published'}
        </span>
      )}
    >
      <div className="flex flex-col gap-5">
        {/* Masthead. The bounded photograph, cropped square, is what a betting
            page would lead with and what the collapsed card reduces to a corner
            mark -- so the popup reads as an expansion of the card rather than as
            a different screen that happens to share a subject. */}
        <div className="flex items-center gap-4">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden border border-[var(--color-chrome-lo)]">
            <img src={image.src} alt={image.alt} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <img
                src={MEDIA_MARKS[mediaId]}
                alt=""
                aria-hidden="true"
                className="h-9 w-9 shrink-0 object-contain"
              />
              <div className="min-w-0">
                <p className="truncate t-h2" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
                  {profile.name}
                </p>
                <p className="truncate t-caption text-[var(--color-ink-dim)]">
                  {profile.outlet} · {profile.role}
                </p>
              </div>
            </div>
            <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
              {Math.round(profile.confidence * 100)}% conviction · {profile.methodLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToBetting}
            className="hidden shrink-0 border border-[var(--color-chrome-hi)] bg-[var(--color-panel-2)] px-3 py-1.5 t-caption text-[var(--color-gold-hi)] transition-colors hover:bg-[var(--color-panel)] sm:block"
          >
            Open the betting page
          </button>
        </div>

        {/* The moneylines, unchanged from the slate. Same prices, same
            disagreement figure, no re-derivation -- a second presentation of the
            same number that disagreed with the first would be worse than none. */}
        <section>
          <h3 className="t-label mb-2 text-[var(--color-ink-faint)]">
            Moneyline
            {slateDate ? <span className="ml-2 normal-case">{slateDate}</span> : null}
          </h3>
          {lines.length === 0 ? (
            <p className="t-body text-[var(--color-ink-dim)]">No games on the current slate.</p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {lines.map((line) => (
                <div
                  key={line.gameId}
                  className="flex items-center gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2.5 py-1.5"
                >
                  <TeamLogo team={line.awayTeam} sizeClass="h-6 w-6" />
                  <span className="truncate t-stat-sm">{line.awayTeam.city}</span>
                  <span className="t-caption text-[var(--color-ink-faint)]">at</span>
                  <TeamLogo team={line.homeTeam} sizeClass="h-6 w-6" />
                  <span className="truncate t-stat-sm">{line.homeTeam.city}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <span
                      className="t-stat-sm tabular-nums"
                      style={{ color: `var(--color-media-${profile.accent}-hi)` }}
                    >
                      {formatAmerican(line.odds[mediaId])}
                    </span>
                    <span className="t-caption tabular-nums text-[var(--color-ink-faint)]">
                      {Math.round(line.disagreement * 100)}pt
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="t-label mb-2 text-[var(--color-ink-faint)]">Props</h3>
          <MediaPropBoard
            markets={props}
            mediaId={mediaId}
            slateDate={slateDate}
            matchupLabel={matchupLabel}
            teamCity={teamCity}
            onOpen={onOpenProp}
          />
        </section>

        {/* The method, because the card's whole argument is that a forecaster you
            cannot audit is not usable. It lives at the foot of the popup rather
            than in it: it is the reason to trust the numbers, not part of the
            numbers. */}
        <section className="border-t border-[var(--color-chrome-lo)] pt-4">
          <MediaMethodPanel profile={profile} />
        </section>

        <section>
          <p className="t-label mb-2 text-[var(--color-ink-faint)]">In their own words</p>
          <MediaVoicePanel profile={profile} />
        </section>
      </div>
    </Modal>
  );
};
