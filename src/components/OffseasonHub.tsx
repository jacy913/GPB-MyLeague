import React from 'react';
import { Check, ChevronRight, Circle, FastForward, Trophy } from 'lucide-react';

export type OffseasonChecklistStage = 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';

interface OffseasonHubProps {
  seasonYear: number;
  stage: OffseasonChecklistStage;
  championLabel: string;
  awardsComplete: boolean;
  lotteryComplete: boolean;
  draftComplete: boolean;
  onAwards: () => void;
  onRetirements: () => void;
  onLottery: () => void;
  onDraft: () => void;
  onFreeAgency: () => void;
  onStartSeason: () => void;
}

const steps: Array<{ key: OffseasonChecklistStage; title: string; description: string }> = [
  { key: 'awards', title: 'Season Awards', description: 'Select Batting MVP, Pitching MVP, and World Series MVP.' },
  { key: 'retirements', title: 'Player Retirements', description: 'Age the league and announce retiring veterans.' },
  { key: 'draft_lottery', title: 'Draft Lottery', description: 'Lock the rookie draft order.' },
  { key: 'draft', title: 'Rookie Draft', description: 'Make picks manually or quick-sim the class.' },
  { key: 'free_agency', title: 'Free Agency', description: 'Open the market, use Shake Up, and finalize roster movement.' },
  { key: 'start_next_season', title: 'Start Next Season', description: 'Generate the new schedule and begin a fresh campaign.' },
];

export const OffseasonHub: React.FC<OffseasonHubProps> = ({
  seasonYear, stage, championLabel, awardsComplete, lotteryComplete, draftComplete,
  onAwards, onRetirements, onLottery, onDraft, onFreeAgency, onStartSeason,
}) => {
  const activeIndex = steps.findIndex((entry) => entry.key === stage);
  const isComplete = (key: OffseasonChecklistStage, index: number): boolean =>
    key === 'awards' ? awardsComplete : key === 'draft_lottery' ? lotteryComplete : key === 'draft' ? draftComplete : index < activeIndex;
  const handlers: Record<OffseasonChecklistStage, () => void> = {
    awards: onAwards, retirements: onRetirements, draft_lottery: onLottery, draft: onDraft, free_agency: onFreeAgency, start_next_season: onStartSeason,
  };

  return <section className="mx-auto max-w-5xl space-y-6">
    <article className="rounded-[2rem] border border-[#d4bb6a]/25 bg-[radial-gradient(circle_at_top_left,rgba(212,187,106,0.22),transparent_42%),linear-gradient(135deg,#1c1c1c,#101010)] p-8">
      <div className="flex items-start gap-4">
        <Trophy className="mt-1 h-8 w-8 text-[#ecd693]" />
        <div><p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Offseason Checklist</p>
          <h1 className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">{seasonYear} Offseason</h1>
          <p className="mt-3 text-sm text-zinc-300">World Series champion: {championLabel}. Complete each event in order, or quick-sim the active event.</p>
        </div>
      </div>
    </article>
    <div className="space-y-3">{steps.map((entry, index) => {
      const complete = isComplete(entry.key, index); const active = entry.key === stage; const locked = index > activeIndex;
      return <article key={entry.key} className={`flex flex-col gap-4 rounded-[1.5rem] border p-5 md:flex-row md:items-center ${active ? 'border-[#d4bb6a]/45 bg-[#d4bb6a]/10' : 'border-white/10 bg-[#171717]'}`}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/25">{complete ? <Check className="h-5 w-5 text-emerald-300" /> : active ? <FastForward className="h-5 w-5 text-[#ecd693]" /> : <Circle className="h-4 w-4 text-zinc-600" />}</div>
        <div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Event {index + 1}</p><h2 className="mt-1 font-headline text-2xl uppercase tracking-[0.06em] text-white">{entry.title}</h2><p className="mt-1 text-sm text-zinc-400">{entry.description}</p></div>
        <button type="button" disabled={locked || complete} onClick={handlers[entry.key]} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ecd693] hover:bg-[#d4bb6a]/20 disabled:cursor-not-allowed disabled:opacity-45">{complete ? 'Complete' : active ? (entry.key === 'start_next_season' ? 'Confirm Start' : 'Simulate Event') : 'Locked'} {!complete && active && <ChevronRight className="h-4 w-4" />}</button>
      </article>;
    })}</div>
  </section>;
};
