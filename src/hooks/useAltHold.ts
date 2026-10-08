import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Hook to detect Alt key held for a specified duration.
 * Returns true while the hold threshold is met and Alt is still pressed.
 */
export const useAltHold = (holdMs = 2000): boolean => {
  const [isHeld, setIsHeld] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const altPressedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !altPressedRef.current) {
        altPressedRef.current = true;
        // Don't start timer if already held (prevents retrigger on repeat events)
        if (!isHeld) {
          holdTimerRef.current = window.setTimeout(() => {
            setIsHeld(true);
          }, holdMs);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        altPressedRef.current = false;
        clearTimer();
        setIsHeld(false);
      }
    };

    // Also clear on blur (user tabs away)
    const onBlur = () => {
      clearTimer();
      setIsHeld(false);
      altPressedRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearTimer();
    };
  }, [holdMs, isHeld, clearTimer]);

  return isHeld;
};
