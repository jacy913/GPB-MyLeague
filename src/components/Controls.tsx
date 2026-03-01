import React from 'react';
import { Play, RotateCcw, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ControlsProps {
  onSimulate: () => void;
  onReset: () => void;
  isSimulating: boolean;
  progress: number;
  seasonComplete: boolean;
}

export const Controls: React.FC<ControlsProps> = ({ onSimulate, onReset, isSimulating, progress, seasonComplete }) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 bg-gradient-to-r from-[#212121] via-[#2a2a2a] to-[#212121] p-4 rounded-2xl border border-white/15 shadow-2xl shadow-black/40 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-y-0 -left-24 w-48 bg-gradient-to-r from-prestige/0 via-prestige/30 to-prestige/0 skew-x-[-20deg]" />
        <div className="absolute inset-y-0 right-[-6rem] w-48 bg-gradient-to-r from-platinum/0 via-platinum/30 to-platinum/0 skew-x-[-20deg]" />
      </div>

      <div className="flex-1">
        <div className="flex justify-between text-xs uppercase tracking-wider text-zinc-400 mb-2">
          <span>Season Progress</span>
          <span className="font-mono text-white">{Math.round(progress)}%</span>
        </div>
        <div className="h-2.5 bg-black/45 rounded-full overflow-hidden border border-white/10">
          <motion.div 
            className="h-full bg-gradient-to-r from-prestige via-zinc-200 to-platinum"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'tween', ease: 'linear' }}
          />
        </div>
      </div>

      <div className="flex gap-2">
        {!seasonComplete ? (
          <button
            onClick={onSimulate}
            disabled={isSimulating}
            className="flex items-center justify-center gap-2 min-w-[210px] px-6 py-2.5 bg-gradient-to-r from-prestige to-platinum hover:brightness-110 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-display font-bold tracking-wide uppercase rounded-xl transition-all shadow-lg active:scale-95"
          >
            {isSimulating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Simulating...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                Simulate Season
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onReset}
            className="flex items-center justify-center gap-2 min-w-[210px] px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white font-display font-bold tracking-wide uppercase rounded-xl transition-all shadow-lg active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Season
          </button>
        )}
      </div>
    </div>
  );
};
