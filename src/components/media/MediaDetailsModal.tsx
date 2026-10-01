import React from 'react';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID } from '../../data/media';
import { MEDIA_IMAGES, MEDIA_MARKS } from './mediaImages';
import { MediaMethodPanel, MediaVoicePanel } from './MediaCard';
import { Modal } from '../ui';

/**
 * The details popup: WHO YOU ARE TRUSTING, AND NOTHING ELSE.
 *
 * This used to be the outlet's whole night -- logo, published moneylines, five props,
 * method, voice -- and it duplicated what the page already shows directly beneath the
 * card you clicked. Opening it told you less than the screen you were already on.
 *
 * So it now carries one thing: the character. The photograph, the name, the outlet and
 * desk, the conviction figure, the thesis in their own framing, the actual weights
 * behind the number, the stated weakness, and the voice samples.
 *
 * That is the right division because the two things it dropped were reachable without
 * a click, and the thing it kept was not. An outlet's published prices are on the slate
 * and on the props panel in the page body. Nobody has to open a dialog to find them.
 * But there was no other route to the method, and the method is the whole basis for
 * treating this forecaster as worth a wager -- a number you cannot audit is a number
 * you cannot act on. So the dialog kept the part that was otherwise unreachable and
 * dropped the part that was already in front of you.
 *
 * The masthead still leads, because the popup is reached from a card that already
 * names the outlet and this has to be usable once it is on top of everything else. The
 * three outlets are distinguishable by logo and colour rather than by name, so
 * recognition does not require reading.
 */
export const MediaDetailsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  mediaId: MediaId;
  /** Sends the manager to the betting page, where every market is actually wagered. */
  onGoToBetting: () => void;
}> = ({ isOpen, onClose, mediaId, onGoToBetting }) => {
  const profile = MEDIA_BY_ID[mediaId];
  const image = MEDIA_IMAGES[mediaId];

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

        {/*
          THE THESIS, which used to live in a collapsible panel on the page itself.

          It reads as prose and it is deliberately not truncated. The earlier version
          clamped it to two lines and appended an ellipsis, which produced a sentence
          ending mid-clause with no way to see the rest -- the panel could be expanded,
          but only if you happened to notice it was clamped at all. Prose that carries
          the argument has to arrive whole or not at all.
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