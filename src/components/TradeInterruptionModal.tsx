import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight } from 'lucide-react';

interface TradeInterruptionPrompt {
  count: number;
  date: string;
}

interface TradeInterruptionModalProps {
  prompt: TradeInterruptionPrompt | null;
  onDismiss: () => void;
  onOpenTradeDesk: () => void;
}

export const TradeInterruptionModal = ({
  prompt,
  onDismiss,
  onOpenTradeDesk,
}: TradeInterruptionModalProps) => (
  <AnimatePresence>
    {prompt && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.98 }}
          className="w-full max-w-xl rounded-[2rem] border border-[#d4bb6a]/25 bg-[linear-gradient(145deg,#121212,#1a1a1a,#0c0c0c)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d4bb6a]/30 bg-[#d4bb6a]/10">
                <ArrowLeftRight className="h-7 w-7 text-[#ecd693]" />
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Alert</p>
                <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">
                  {prompt.count} Trade{prompt.count === 1 ? '' : 's'} Need Approval
                </p>
                <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-300">
                  The sim finished {prompt.date} before stopping. Review the proposals when you are ready without forcing an immediate screen swap.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full border border-white/10 bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:border-white/20 hover:text-white"
            >
              Later
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={onOpenTradeDesk}
              className="rounded-2xl border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.26),rgba(212,187,106,0.1))] px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-white"
            >
              Open Trade Desk
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Stay Here
            </button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
