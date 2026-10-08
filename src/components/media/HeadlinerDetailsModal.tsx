import React from 'react';
import { ACCENT_VAR, HEADLINER_BY_ID, type GameEventKind, type HeadlinerId } from '../../logic/headliners';
import { VOICE_BANKS } from '../../logic/headlinerVoices';
import { HEADLINER_WALLPAPERS } from './headlinerImages';
import { Modal } from '../ui';

/**
 * A REPORTER'S DOSSIER.
 *
 * ============================================================================
 * THE PREVIOUS DESIGN, AND WHY IT WAS REPLACED
 * ============================================================================
 *
 * It opened with a full-bleed photograph of the reporter at 208px tall, with a small portrait plate
 * sitting on top of it in the corner, and then ran three italic beat lines, five bordered "covers"
 * boxes and two more italic quotes. Screenshotted, it read as soup: a large photo of a person
 * shouting at the reader, a second smaller picture of the same person pasted over it, and then eleven
 * nearly identical italic lines with no hierarchy between them. The photograph was competing with the
 * portrait for the job of saying who this is, and losing, because a 96px plate is what you actually
 * recognise a byline by.
 *
 * ============================================================================
 * WHAT REPLACED IT, AND THE ONE IDEA
 * ============================================================================
 *
 * It is now a PRINTED PAGE, and the single organising idea is ONE THING PER BLOCK, in the order a
 * reader wants them:
 *
 *   WHO      a 16:9 masthead carrying the name and role
 *   WHAT THEY BELIEVE   one beat, set as a pull-quote
 *   WHAT THEY COVER     one line of text
 *   WHAT THEY SAY       one sample, under a rule
 *
 * ONE THING PER BLOCK also means ONE PICTURE. The previous version had a large photograph AND a
 * portrait plate pasted over it -- two pictures of the same person arguing about who he is, in a
 * layout where the big one lost. The wallpaper is a picture OF the reporter, so it does the job on
 * its own and the plate is gone from here. The circular mark still exists, on the byline, which is
 * the one place a reader recognises a voice by its badge.
 *
 * The masthead is 16:9 because that is the shape the artwork is: every reporter wallpaper is a
 * 1376x768 frame. Letterboxing a 16:9 source into a 20px strip threw away most of the picture and
 * left a smear, which is the third way this design had been wrong. Kept at its own shape it reads as
 * a photograph of a place, and the reporter's name sits on the bottom third where the gradient is
 * heaviest -- so the forecaster registry's rule still holds and nothing legible rests on the image
 * itself.
 *
 * One beat instead of three, one sample instead of two. That is not a reduction for its own sake:
 * three italic lines of identical weight is a wall, and a wall is what you stop reading. A single
 * line, larger and set against an accent rule, is a claim -- which is what a beat is.
 */

export interface HeadlinerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  headlinerId: HeadlinerId | null;
}

/**
 * Event-kind labels, so a beat reads as English rather than as an enum.
 *
 * Typed as a complete `Record` on purpose. Every other kind in this app is exhaustively mapped in
 * at least one place, so adding an event kind cannot compile until somebody writes down what it is
 * called -- which is how the postseason kinds turned a two-second omission into a type error rather
 * than a card reading "series_clinched" in the reporter dossier.
 */
const KIND_LABEL: Record<GameEventKind, string> = {
  no_hitter: 'no-hitter',
  perfect_game: 'perfect game',
  cycle: 'cycle',
  multi_homer: 'multi-homer',
  rbi_barrage: 'RBI barrage',
  on_base_machine: 'on-base machine',
  hit_fury: 'hit fury',
  walk_off: 'walk-off',
  pitching_dome: 'pitching dome',
  complete_game: 'complete game',
  staff_wins: 'staff wins',
  extra_innings: 'extra innings',
  momentum_swing: 'momentum swing',
  blowout: 'blowout',
  shutout: 'shutout',
  series_clinched: 'series clinched',
  eliminated: 'eliminated',
  championship: 'championship',
  scrap_heap: 'scrap heap',
  one_run_game: 'one-run game',
  underdog_win: 'underdog win',
  meltdown: 'meltdown',
  big_debut: 'big debut',
  young_player: 'young player',
  losing_streak: 'losing streak',
  winning_streak: 'winning streak',
  anomaly: 'anomaly',
  sustained_rate: 'sustained rate',
  expected_divergence: 'expected vs actual',
};

/**
 * One quote, taken deterministically from the persona's own banks.
 *
 * Deterministic because `pickBeat` already seeds from the event so the same save shows the same
 * newsroom; a dossier that reshuffled its quote on every open would be a different kind of lie. These
 * come from the `generic` banks, which are the lines that render on any event, so a sample can never
 * fail to match whatever game the reader arrived from.
 */
const oneVoice = (id: HeadlinerId, offset: number): string | null => {
  const bank = VOICE_BANKS[id];
  if (!bank) return null;
  const pool = [...bank.titles.generic, ...bank.decks.generic];
  if (pool.length === 0) return null;
  return pool[offset % pool.length];
};

const BlockLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="t-label text-[var(--color-ink-faint)]">{children}</span>
);

export const HeadlinerDetailsModal: React.FC<HeadlinerDetailsModalProps> = ({
  isOpen,
  onClose,
  headlinerId,
}) => {
  if (!headlinerId) return null;
  const profile = HEADLINER_BY_ID[headlinerId];
  if (!profile) return null;

  const wallpaper = HEADLINER_WALLPAPERS[headlinerId];
  const accent = ACCENT_VAR[profile.accentToken];
  const beat = profile.beat[0];
  const voice = oneVoice(headlinerId, 1);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span style={{ color: accent }}>{profile.displayName}</span>
          <span className="t-caption text-[var(--color-ink-faint)]">{profile.role}</span>
        </span>
      }
      widthClass="max-w-xl"
    >
      {/*
        THE MASTHEAD. 16:9, the shape the artwork actually is, with the identity on the bottom third
        where the gradient is heaviest. `alt` is kept -- unlike the byline backdrop, this is the only
        description of the reporter's surroundings.
      */}
      <div className="relative mb-4 overflow-hidden border border-[var(--color-chrome-lo)]">
        {wallpaper ? (
          <>
            <img
              src={wallpaper.src}
              alt={wallpaper.alt}
              loading="lazy"
              className="aspect-video w-full object-cover"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(5,7,13,0.25) 0%, rgba(5,7,13,0.55) 55%, rgba(5,7,13,0.94) 100%)',
              }}
            />
          </>
        ) : (
          <div className="aspect-video w-full bg-[var(--color-sunken)]" aria-hidden="true" />
        )}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3">
          <p className="t-h3" style={{ color: accent }}>{profile.displayName}</p>
          <p className="t-caption text-[var(--color-ink-dim)]">
            {profile.outlet} &middot; {profile.role}
          </p>
        </div>
      </div>

      {/* WHAT THEY BELIEVE. One line, against an accent rule. */}
      {beat && (
        <div className="mt-4 border-l-2 pl-3" style={{ borderColor: accent }}>
          <BlockLabel>The beat</BlockLabel>
          <p className="mt-0.5 t-body italic text-[var(--color-ink)]">{beat}</p>
        </div>
      )}

      {/* WHAT THEY COVER. A line of text, not a row of boxes. */}
      <div className="mt-4 flex flex-col gap-1">
        <BlockLabel>Covers</BlockLabel>
        <p className="t-caption text-[var(--color-ink-dim)]">
          {profile.covers.map((k) => KIND_LABEL[k]).join(' · ')}
        </p>
      </div>

      {/* WHAT THEY SAY. One sample, below a rule, deliberately quieter than the beat. */}
      {voice && (
        <div className="mt-4 border-t border-[var(--color-chrome-lo)] pt-3">
          <BlockLabel>Also says</BlockLabel>
          <p className="mt-0.5 t-caption italic text-[var(--color-ink-dim)]">{voice}</p>
        </div>
      )}
    </Modal>
  );
};