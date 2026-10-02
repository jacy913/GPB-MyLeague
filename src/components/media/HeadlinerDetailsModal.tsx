import React from 'react';
import { HEADLINER_BY_ID, type HeadlinerId } from '../../logic/headliners';
import { VOICE_BANKS } from '../../logic/headlinerVoices';
import { HEADLINER_WALLPAPERS } from './headlinerImages';
import { HeadlinerPortrait } from '../ui/HeadlinerPortrait';
import { Modal } from '../ui';
import { ACCENT_VAR } from '../../logic/headliners';

/**
 * A REPORTER'S DOSSIER.
 *
 * ============================================================================
 * WHY A MODAL AND NOT A PAGE
 * ============================================================================
 *
 * Reporters have no hub, no route, no card grid and no table. They exist in exactly one place: the
 * byline on a headline. Building them a page means inventing navigation for six characters who are
 * never browsed, and a page with one entry point is a page nobody finds. So the entry point is the
 * byline itself, and the destination is the only shape that suits something you reach from a
 * sentence rather than from a list.
 *
 * ============================================================================
 * WHY THE WALLPAPER RUNS AT FULL STRENGTH HERE, AND ONLY HERE
 * ============================================================================
 *
 * The forecaster registry's comment is the rule and it is not negotiable: "a wallpaper at full
 * strength behind a price is a wallpaper you cannot read a price on." Nothing numeric is layered over
 * this hero -- no price, no figure, no probability -- so the thing the rule protects is not present
 * and the budget can relax. This is the one surface where the wallpaper is being LOOKED AT rather than
 * sat behind, which is the distinction the wallpaper plan draws in its §5.4.
 *
 * The byline strip on the newsroom panel uses a LIGHTER scrim than the forecaster card for the same
 * reason in the other direction: a name is not a price, so the reporter backdrop can stay warmer and
 * still be readable.
 */
export interface HeadlinerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  headlinerId: HeadlinerId | null;
}

/** Event-kind labels, so a beat reads as English rather than as an enum. */
const KIND_LABEL: Record<string, string> = {
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
 * Two voice samples, taken deterministically from the persona's own banks.
 *
 * Deterministic on purpose: `pickBeat` already seeds from the event so the same save shows the same
 * newsroom, and a dossier that reshuffled its quotes on every open would be a different kind of lie.
 * These come from the `generic` banks, which are the lines that render on any event, so the samples
 * cannot fail to match whatever game the reader happened to arrive from.
 */
const sampleVoices = (id: HeadlinerId, count: number): string[] => {
  const bank = VOICE_BANKS[id];
  if (!bank) return [];
  const pool = [...bank.titles.generic, ...bank.decks.generic];
  const out: string[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i += 1) {
    const line = pool[(i * 2 + 1) % pool.length];
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
};

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
  const voices = sampleVoices(headlinerId, 2);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span style={{ color: accent }}>{profile.displayName}</span>
          <span className="t-caption text-[var(--color-ink-faint)]">
            {profile.outlet} &middot; {profile.role}
          </span>
        </span>
      }
      widthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        {wallpaper ? (
          <div className="relative overflow-hidden border border-[var(--color-chrome-lo)]">
            <img
              src={wallpaper.src}
              alt={wallpaper.alt}
              loading="lazy"
              className="h-40 w-full object-cover sm:h-52"
            />
            {/*
              A short gradient rather than the forecaster card's three-stop scrim. There is nothing
              to read across this strip -- the name is in the modal's own title bar -- so the job here
              is only to stop the portrait from sitting on a raw photograph. Kept deliberately weak so
              the wallpaper is actually visible, which is the entire reason this surface exists.
            */}
            <div
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, rgba(5,7,13,0.10) 0%, rgba(5,7,13,0.55) 100%)',
              }}
            />
            <div className="absolute bottom-2 left-3 flex items-center gap-2">
              <HeadlinerPortrait id={headlinerId} size="lg" />
              <span className="t-caption text-[var(--color-ink-dim)]">{profile.outlet}</span>
            </div>
          </div>
        ) : (
          /*
            The bare fallback, kept real. The wallpaper plan wanted Gatz to have none so the absence
            would read as character; he has one, so this path is no longer a designed moment. It stays
            because a `Partial` registry has to have a defined behaviour for absence, and because a
            reporter who loses an asset should degrade rather than break.
          */
          <div className="flex items-center gap-3 border border-[var(--color-chrome-lo)] px-3 py-4">
            <HeadlinerPortrait id={headlinerId} size="lg" />
            <span className="t-caption text-[var(--color-ink-faint)]">{profile.outlet}</span>
          </div>
        )}

        {/*
          THE BEAT, verbatim. This reporter's standing position, in their own words -- the same lines
          the newsroom panel shows, because the dossier is a deeper look at the same person rather
          than a different one.
        */}
        <div className="flex flex-col gap-1">
          {profile.beat.slice(0, 3).map((line) => (
            <p key={line} className="t-body italic text-[var(--color-ink-dim)]">&ldquo;{line}&rdquo;</p>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          <span className="t-caption text-[var(--color-ink-faint)]">Covers</span>
          <div className="flex flex-wrap gap-1">
            {profile.covers.map((kind) => (
              <span
                key={kind}
                className="border border-[var(--color-chrome-lo)] px-2 py-0.5 t-caption text-[var(--color-ink-dim)]"
              >
                {KIND_LABEL[kind] ?? kind}
              </span>
            ))}
          </div>
        </div>

        {voices.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="t-caption text-[var(--color-ink-faint)]">In their words</span>
            {voices.map((line) => (
              <p key={line} className="t-body text-[var(--color-ink)]">&ldquo;{line}&rdquo;</p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};