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
    <div className="flex items-center gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700 shadow-xl">
      <div className="flex-1">
        <div className="flex justify-between text-xs uppercase tracking-wider text-slate-400 mb-1">
          <span>Season Progress</span>
          <span className="font-mono text-slate-200">{Math.round(progress)}%</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-emerald-500"
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
            className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-display font-bold tracking-wide uppercase rounded-lg transition-all shadow-lg hover:shadow-emerald-500/20 active:scale-95"
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
            className="flex items-center gap-2 px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white font-display font-bold tracking-wide uppercase rounded-lg transition-all shadow-lg active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Season
          </button>
        )}
      </div>
    </div>
  );
};
