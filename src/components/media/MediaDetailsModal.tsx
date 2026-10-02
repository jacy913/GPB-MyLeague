import React from 'react';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID } from '../../data/media';
import { MEDIA_PORTRAITS, MEDIA_MARKS } from './mediaImages';
import { MediaMethodPanel, MediaVoicePanel } from './MediaCard';
import { Modal } from '../ui';

/**
 * The details popup: WHO YOU ARE TRUSTING, AND NOTHING ELSE.
 *
 * This used to be the outlet's whole night -- logo, published moneylines, five props,
 * method, voice -- and it duplicated what the page already shows directly beneath the
 * card you clicked. Opening it told you less than the screen you were already on.
 *
 * So it now carries one thing: the character. The portrait, the name, the outlet and desk,
 * the conviction figure, the thesis in their own framing, the actual weights behind the
 * number, the stated weakness, and the voice samples.
 *
 * That is the right division because the two things it dropped were reachable without a
 * click, and the thing it kept was not. An outlet's published prices are on the slate and
 * on the props panel in the page body. Nobody has to open a dialog to find them. But there
 * was no other route to the method, and the method is the whole basis for treating this
 * forecaster as worth a wager -- a number you cannot audit is a number you cannot act on.
 */
export const MediaDetailsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  mediaId: MediaId;
  /** Sends the manager to the betting page, where every market is actually wagered. */
  onGoToBetting: () => void;
}> = ({ isOpen, onClose, mediaId, onGoToBetting }) => {
  const profile = MEDIA_BY_ID[mediaId];
  const portrait = MEDIA_PORTRAITS[mediaId];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      accent={profile.accent}
      widthClass="max-w-4xl"
      title={profile.name}
      barRight={(
        <span className="t-caption text-[var(--color-ink-faint)]">
          {profile.outlet} · {profile.role}
        </span>
      )}
    >
      <div className="flex flex-col gap-5">
        {/*
          THE HERO.

          The header used to be a 96px square masthead crop in a row with the name, on the
          reasoning that "the popup is reached from a card that already names the outlet, so a
          mark is enough". That was true when the only available picture was a crop of a
          broadcast set, and it is the reason this popup read as a settings dialog: a
          thumbnail-sized portrait beside a name is a list row, not a character.

          With the supplied portraits this can lead properly, and the composition follows from
          what the three pictures ARE rather than from a template:

            hollis   one man, loose framing, set right of centre
            glorest  one man, already tight to the shoulders
            sharply  TWO hosts, both logos on their shirts

          So the portrait is a fixed 4:5 frame -- generous enough for the tight shot, cropped no
          tighter than the loose one -- and the two-host shot simply fills it. Nothing here
          assumes a single subject, because two of the three have one and one of them does not.
          See `buildMediaPortraits.ts` for how the three frames are derived separately.

          THE PORTRAIT KEEPS ITS ALPHA and sits directly on the popup's surface. A white or
          photographic plate behind it would draw a visible rectangle around a subject who has
          no rectangular edge -- the cut-out is the thing, and boxing it defeats it.

          THE ACCENT is the outlet's own identity colour, as a left edge on the frame and as
          the fill of the conviction bar below. Not green and not orange: those two mean
          "safe" and "hot" and belong to the prop temperament on the betting screen. Nothing on
          this popup is a bet, so it borrows nothing from that vocabulary.
        */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <div
            className="w-40 shrink-0 border border-[var(--color-chrome-lo)] border-l-[3px] bg-[var(--color-sunken)] sm:w-44"
            style={{ borderLeftColor: `var(--color-media-${profile.accent})` }}
          >
            <div className="aspect-[4/5] w-full">
              <img
                src={portrait.src}
                alt={portrait.alt}
                className="h-full w-full object-cover object-top"
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/*
              IDENTITY. Mark, then name, then desk -- in that order, because the mark is how the
              three are told apart at a glance and the name is how you read them once you have
              stopped recognising them. The name is a heading rather than a paragraph because
              this dialog has a title attribute too, and a second unlabelled heading of the
              same rank in the same colour reads as a mistake.
            */}
            <div className="flex items-start gap-3">
              <img
                src={MEDIA_MARKS[mediaId]}
                alt=""
                aria-hidden="true"
                className="h-10 w-10 shrink-0 object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate t-h2" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
                  {profile.name}
                </p>
                <p className="t-caption truncate text-[var(--color-ink-dim)]">
                  {profile.outlet} · {profile.role}
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

            {/*
              CONVICTION, promoted from a footnote to a figure.

              It was "72% conviction · Advanced" on a caption line, which made the outlet's own
              confidence read as a note about the method rather than as the second most
              important number on the screen. It is what tells you how far to trust everything
              underneath it, so it is now a stat.

              The BAR exists because a percentage with nothing beside it is just a number --
              72% means nothing until it has the other two outlets to sit beside, and it does
              not get them here, so the bar gives the eye a length to read instead. It is
              filled in the outlet's own accent rather than green or orange, for the reason
              given above.
            */}
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="shrink-0">
                <p className="t-caption text-[var(--color-ink-faint)]">Conviction</p>
                <p
                  className="t-stat-lg tabular-nums"
                  style={{ color: `var(--color-media-${profile.accent}-hi)` }}
                >
                  {Math.round(profile.confidence * 100)}%
                </p>
              </div>
              <div className="min-w-[9rem] flex-1 pb-1">
                <p className="t-caption text-[var(--color-ink-faint)]">Method</p>
                <p className="t-label text-[var(--color-ink-dim)]">{profile.methodLabel}</p>
              </div>
              <div
                aria-hidden="true"
                className="h-1.5 min-w-[7rem] flex-1"
                style={{ background: `var(--color-media-${profile.accent}-dim)` }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.round(profile.confidence * 100)}%`,
                    background: `var(--color-media-${profile.accent})`,
                  }}
                />
              </div>
            </div>

            {/*
              THE CTA, TWICE, ON PURPOSE -- and that is not an oversight.

              There is no way to put one button that is both beside the name on a wide screen
              and usable on a narrow one, so it is rendered twice and hidden by breakpoint.
              The alternative -- dropping it below the portrait on every screen -- costs the
              wide layout its best position, which is beside the identity where the eye lands
              first. Duplicating a control is uglier than moving it, and this was measured
              against both other options before it was chosen.
            */}
            <button
              type="button"
              onClick={onGoToBetting}
              className="self-start border border-[var(--color-chrome-hi)] bg-[var(--color-panel-2)] px-3 py-1.5 t-caption text-[var(--color-gold-hi)] transition-colors hover:bg-[var(--color-panel)] sm:hidden"
            >
              Open the betting page
            </button>
          </div>
        </div>

        {/*
          THE THESIS, which used to live in a collapsible panel on the page itself.

          It reads as prose and it is deliberately not truncated. The earlier version clamped it
          to two lines and appended an ellipsis, which produced a sentence ending mid-clause with
          no way to see the rest -- the panel could be expanded, but only if you happened to
          notice it was clamped at all. Prose that carries the argument has to arrive whole or
          not at all.
        */}
        <section>
          <h3 className="t-label mb-2 text-[var(--color-ink-faint)]">How they see it</h3>
          <p className="t-body text-[var(--color-ink-dim)]">{profile.thesis}</p>
        </section>

        {/* The method, because the card's whole argument is that a forecaster you
            cannot audit is not usable. */}
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