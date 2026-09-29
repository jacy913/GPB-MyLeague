import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Panel, RetroButton } from '../ui';

export const TerminateUniverseModal: React.FC<{
  seedInput: string;
  controlsLocked: boolean;
  onSetSeed: (value: string) => void;
  onClose: () => void;
  onPreview: () => void;
  onConfirm: () => void;
}> = ({ seedInput, controlsLocked, onSetSeed, onClose, onPreview, onConfirm }) => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[color:color-mix(in_srgb,var(--color-void)_85%,transparent)] px-4 py-6">
    <div role="dialog" aria-modal="true" aria-labelledby="terminate-title" className="w-full max-w-xl">
      <Panel className="border-[var(--color-neg)] overflow-hidden">
        <div className="chrome-bar flex items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-neg)]" aria-hidden="true" />
            <h2 id="terminate-title" className="t-h3 text-[var(--color-neg)]">New Universe</h2>
          </div>
          <span className="t-caption text-[var(--color-ink-faint)]">DANGER ZONE</span>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <p className="t-body text-[var(--color-ink-dim)]">
            Rebuilds the league from scratch: all players, all season history, the draft board, and
            the current season state. The new pool is generated, developed, and rostered in one pass,
            so the model is already in force on day one.
          </p>

          <Panel variant="sunken" className="p-3">
            <label htmlFor="universe-seed" className="t-label block text-[var(--color-ink-dim)]">
              Universe Seed
            </label>
            <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
              The same seed rebuilds the same universe exactly, so you can rerun a model change
              against a fixed baseline. Change it to reroll the player pool.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="universe-seed"
                type="text"
                inputMode="numeric"
                value={seedInput}
                onChange={(event) => onSetSeed(event.target.value)}
                className="min-w-0 flex-1 border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-3 py-2 t-stat-sm text-[var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
              />
              <RetroButton
                variant="default"
                size="sm"
                onClick={() => onSetSeed(String(Math.floor(Math.random() * 999999)))}
              >
                Reroll
              </RetroButton>
            </div>
          </Panel>

          <div className="grid gap-2 sm:grid-cols-2">
            <RetroButton variant="ghost" onClick={onClose}>Cancel</RetroButton>
            <RetroButton variant="default" onClick={onPreview} disabled={controlsLocked}>Preview</RetroButton>
            <RetroButton variant="danger" onClick={onConfirm} disabled={controlsLocked} className="sm:col-span-2">
              Terminate &amp; Rebuild
            </RetroButton>
          </div>
        </div>
      </Panel>
    </div>
  </div>
);
