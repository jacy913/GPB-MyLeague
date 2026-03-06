import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SimulationProgressUpdate } from '../logic/simulationManager';

interface SimulationFloatingPanelProps {
  isVisible: boolean;
  simulationProgress: SimulationProgressUpdate | null;
  currentDate: string;
  onOpenSimulation: () => void;
  onCancelSimulation: () => void;
}

export const SimulationFloatingPanel = ({
  isVisible,
  simulationProgress,
  currentDate,
  onOpenSimulation,
  onCancelSimulation,
}: SimulationFloatingPanelProps) => (
  <AnimatePresence>
    {isVisible && simulationProgress && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed bottom-24 right-4 z-[80] w-[min(360px,calc(100vw-2rem))]"
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="w-full rounded-[1.75rem] border border-[#d4bb6a]/20 bg-[linear-gradient(135deg,#121212,#1b1b1b,#101010)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.52)]"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Simulation</p>
              <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{simulationProgress.label}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Active date</p>
              <p className="mt-1 font-mono text-sm uppercase tracking-[0.12em] text-zinc-100">
                {simulationProgress.currentDate || currentDate || 'TBD'}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Progress</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                {simulationProgress.totalGames > 0
                  ? `${simulationProgress.completedGames} / ${simulationProgress.totalGames} games`
                  : `${simulationProgress.completedGames} games`}
              </p>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#d4bb6a,#efe2ab,#37d6be)] transition-[width] duration-300"
                style={{
                  width: `${
                    simulationProgress.totalGames > 0
                      ? Math.max(6, Math.min(100, (simulationProgress.completedGames / simulationProgress.totalGames) * 100))
                      : 12
                  }%`,
                }}
              />
            </div>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Simulation is running in the background. You can keep using other tabs while the calendar advances.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onOpenSimulation}
              className="rounded-2xl border border-[#d4bb6a]/25 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-[#f3dea1]"
            >
              Open Sim
            </button>
            <button
              type="button"
              onClick={onCancelSimulation}
              className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-white"
            >
              Stop
            </button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
