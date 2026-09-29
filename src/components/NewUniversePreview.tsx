/**
 * New Universe preview.
 *
 * The point of this screen is to make the model visible before you commit to
 * it. A fresh universe used to be a single click that produced a pool you had
 * no way to inspect, generated with an unseeded RNG, and with the development
 * model not engaged until a season had been played. This shows what the build
 * actually produced: the age curve with median overall per age, the tier
 * distribution, and whether every roster slot got filled.
 */

import React from 'react';
import { Dices, Check, X } from 'lucide-react';
import type { BuildNewUniverseResult } from '../logic/universeBootstrap';

const StatTile: React.FC<{ label: string; value: string; tone?: 'default' | 'good' | 'warn' }> = ({
  label,
  value,
  tone = 'default',
}) => (
  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
    <p
      className={`font-display text-3xl uppercase tracking-[0.08em] mt-2 ${
        tone === 'good' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-white'
      }`}
    >
      {value}
    </p>
  </div>
);

const barFor = (value: number, max: number, width = 22): string =>
  max <= 0 ? '' : '#'.repeat(Math.max(0, Math.min(width, Math.round((value / max) * width))));

export const NewUniversePreviewModal: React.FC<{
  preview: BuildNewUniverseResult;
  onDismiss: () => void;
  isGenerating?: boolean;
  onConfirm?: () => void;
}> = ({ preview, onDismiss, isGenerating = false, onConfirm }) => {
  const { diagnostics, playerState } = preview;
  const maxAgeCount = Math.max(...diagnostics.ageRows.map((row) => row.count), 1);
  const maxTierCount = Math.max(...diagnostics.tierRows.map((row) => row.count), 1);
  const rostersFull = diagnostics.filledRosterSlots >= diagnostics.expectedRosterSlots;
  // No peak-age test on a freshly generated pool. Overall comes from talent tier
  // quotas, not birthdays, so median overall is flat by age until development
  // carves the curve out over the first few seasons. The Peak Age tile below is
  // the largest sampled cohort, not a finding.
  const share35 = diagnostics.playerCount > 0 ? diagnostics.age35PlusCount / diagnostics.playerCount : 0;
  const pipelineHealthy = diagnostics.callUpCount > 0 && share35 <= 0.15;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#141414] shadow-2xl scrollbar-subtle">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-[#141414] px-6 py-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              New Universe Preview
            </p>
            <h3 className="font-display text-3xl uppercase tracking-[0.12em] text-white mt-1">
              Season {diagnostics.seasonYear}
            </h3>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              seed {diagnostics.seed} &middot; generate &rarr; develop &rarr; fill &middot;{' '}
              {diagnostics.elapsedMs}ms
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-display uppercase tracking-[0.12em] text-zinc-400 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            {onConfirm && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={isGenerating}
                className="inline-flex items-center gap-2 rounded-xl bg-platinum px-5 py-2 text-sm font-display font-bold uppercase tracking-[0.12em] text-black disabled:bg-white/10 disabled:text-slate-500"
              >
                <Check className="h-4 w-4" />
                {isGenerating ? 'Building...' : 'Create Universe'}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-5 border-b border-white/10">
          <StatTile label="Players" value={String(diagnostics.playerCount)} />
          <StatTile label="Active" value={String(diagnostics.activeCount)} />
          <StatTile label="Free Agents" value={String(diagnostics.freeAgentCount)} />
          <StatTile label="Prospects" value={String(diagnostics.prospectCount)} />
          <StatTile
            label="Rosters Filled"
            value={`${diagnostics.filledRosterSlots}/${diagnostics.expectedRosterSlots}`}
            tone={rostersFull ? 'good' : 'warn'}
          />
          <StatTile label="Avg Overall" value={diagnostics.averageOverall.toFixed(1)} />
          <StatTile label="Median Overall" value={diagnostics.medianOverall.toFixed(0)} />
          <StatTile
            label="Largest Cohort"
            value={diagnostics.peakAge ? String(diagnostics.peakAge) : '-'}
            tone={pipelineHealthy ? 'good' : 'warn'}
          />
        </div>

        <div className="grid gap-5 px-6 py-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/10 overflow-hidden">
            <header className="bg-white/5 px-4 py-3">
              <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Age distribution &mdash; flat at birth by design
              </h4>
            </header>
            <div className="max-h-[22rem] overflow-y-auto scrollbar-subtle">
              <table className="w-full font-mono text-[11px]">
                <tbody className="divide-y divide-white/5">
                  {diagnostics.ageRows.map((row) => (
                    <tr key={row.age} className={row.age === diagnostics.peakAge ? 'bg-white/[0.04]' : ''}>
                      <td className="w-10 px-4 py-1.5 text-zinc-300">{row.age}</td>
                      <td className="w-10 px-2 py-1.5 text-right text-zinc-500">{row.count}</td>
                      <td className="w-10 px-2 py-1.5 text-right text-zinc-100">{row.medianOverall.toFixed(0)}</td>
                      <td className="px-2 py-1.5 text-zinc-600">{barFor(row.count, maxAgeCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 overflow-hidden">
              <header className="bg-white/5 px-4 py-3">
                <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                  Talent distribution
                </h4>
              </header>
              <table className="w-full font-mono text-[11px]">
                <tbody className="divide-y divide-white/5">
                  {diagnostics.tierRows.map((row) => (
                    <tr key={row.label}>
                      <td className="px-4 py-1.5 text-zinc-300">{row.label}</td>
                      <td className="w-12 px-2 py-1.5 text-right text-zinc-100">{row.count}</td>
                      <td className="px-2 py-1.5 text-zinc-600">{barFor(row.count, maxTierCount, 14)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-2xl border border-white/10 px-4 py-3">
              <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                Pipeline
              </h4>
              <ul className="mt-2 space-y-1.5 font-mono text-[11px] text-zinc-400">
                <li>
                  call-ups (age 23 or under){' '}
                  <span className={diagnostics.callUpCount > 0 ? 'text-emerald-300' : 'text-amber-300'}>
                    {diagnostics.callUpCount}
                  </span>
                </li>
                <li>
                  age 35 or older <span className="text-zinc-200">{diagnostics.age35PlusCount}</span>
                </li>
                <li>
                  aged out of the pool <span className="text-zinc-200">{diagnostics.retiredByAgeOut}</span>
                </li>
                <li>
                  ratings rows written{' '}
                  <span className="text-zinc-200">
                    {playerState.battingRatings.length + playerState.pitchingRatings.length}
                  </span>
                </li>
              </ul>
            </section>

            <section className="rounded-2xl border border-white/10 px-4 py-3">
              <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                What this build ran
              </h4>
              <ol className="mt-2 space-y-1 font-mono text-[11px] text-zinc-500">
                <li>1. generate player pool from seed</li>
                <li>2. development pass (age curves, usage, potential)</li>
                <li>3. fill roster vacancies and prune the pool</li>
              </ol>
            </section>
          </div>
        </div>

        <footer className="flex items-start gap-3 border-t border-white/10 px-6 py-4">
          <Dices className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
          <p className="font-mono text-[11px] leading-5 text-zinc-500">
            This seed reproduces this exact universe. Change the seed on the New Universe screen to reroll
            the player pool and compare two runs of the same model.
          </p>
        </footer>
      </div>
    </div>
  );
};
