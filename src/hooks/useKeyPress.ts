import { useEffect, useState, useCallback } from 'react';

/**
 * Hook to detect a single key press (default: 't').
 * Returns true while the key is pressed down.
 * Use for momentary overlays that open on key press and close on release.
 */
export const useKeyPress = (key = 't'): boolean => {
  const [isPressed, setIsPressed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === key.toLowerCase() && !e.repeat) {
        setIsPressed(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === key.toLowerCase()) {
        setIsPressed(false);
      }
    };

    // Also clear on blur (user tabs away)
    const onBlur = () => {
      setIsPressed(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [key]);

  return isPressed;
};