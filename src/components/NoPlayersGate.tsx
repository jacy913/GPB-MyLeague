import React from 'react';
import { AlertTriangle, Users, Wand2 } from 'lucide-react';
import { Panel, RetroButton } from './ui';

interface NoPlayersGateProps {
  seed: string;
  teamCount: number;
  isRepairing: boolean;
  onRepair: () => void;
  onTerminate: () => void;
}

/**
 * Blocks the app when a universe has no players.
 *
 * This state is reachable: Terminate Universe clears the player state before it
 * builds the replacement, and the build is a long synchronous chain, so a refresh
 * partway through leaves 32 teams and a full schedule with an empty player pool.
 * Nothing downstream copes with that. The schedule self-heals on boot; the player
 * pool did not, so the league stayed broken with no way back from the UI --
 * handleGeneratePlayers was implemented and threaded through the router but had
 * no consumer anywhere, so the only recovery was to rebuild the whole universe.
 *
 * Deliberately not a dismissible notice. The league is unplayable and every
 * screen downstream of it will look merely empty rather than broken, so a toast
 * the user can wave away would leave them hunting again. It is also not a silent
 * auto-repair: the seed is this user's A/B handle for model changes, and quietly
 * regenerating would replace their league with a different one.
 */
export const NoPlayersGate: React.FC<NoPlayersGateProps> = ({
  seed,
  teamCount,
  isRepairing,
  onRepair,
  onTerminate,
}) => (
  <div className="flex min-h-screen items-center justify-center bg-[var(--color-base)] p-6 text-[var(--color-ink)]">
    <Panel className="w-full max-w-2xl border-l-[3px] border-l-[var(--color-neg)]">
      <div className="chrome-bar flex items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--color-neg)]" aria-hidden="true" />
          <h1 className="t-h3 text-[var(--color-neg)]">League Has No Players</h1>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">REPAIR REQUIRED</span>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <p className="t-body text-[var(--color-ink-dim)]">
          This save has {teamCount} clubs and a full schedule but an empty player pool. It almost
          certainly happened when the page was refreshed while a new universe was being built, since
          the old player data is cleared just before the replacement is generated.
        </p>

        <p className="t-body text-[var(--color-ink-dim)]">
          Nothing will simulate until the pool is rebuilt. Repair runs the full chain &mdash; generate,
          develop, then fill every roster &mdash; so the league is coherent and immediately playable.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
            <p className="t-caption text-[var(--color-ink-faint)]">Universe Seed</p>
            <p className="t-stat mt-1">{seed}</p>
          </div>
          <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
            <p className="t-caption text-[var(--color-ink-faint)]">Clubs Awaiting Players</p>
            <p className="t-stat mt-1">{teamCount}</p>
          </div>
        </div>

        <p className="t-caption text-[var(--color-ink-faint)]">
          Repair uses seed {seed}, so if this universe was built from that seed you get exactly the
          same league back. If it was not, use Rebuild instead to generate a fresh one.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <RetroButton variant="primary" onClick={onRepair} disabled={isRepairing}>
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            {isRepairing ? 'Generating players...' : 'Repair Player Pool'}
          </RetroButton>
          <RetroButton variant="default" onClick={onTerminate} disabled={isRepairing}>
            <Users className="h-4 w-4" aria-hidden="true" />
            Rebuild Universe
          </RetroButton>
        </div>
      </div>
    </Panel>
  </div>
);
