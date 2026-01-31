import { useEffect, useRef, useCallback } from "react";

interface UseAnimationTimerOptions {
  isPlaying: boolean;
  speed: number; // multiplier
  onTick: () => void;
}

export function useAnimationTimer({
  isPlaying,
  speed,
  onTick,
}: UseAnimationTimerOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTickRef = useRef(onTick);

  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  const clear = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    clear();
    if (isPlaying) {
      const ms = Math.max(16, 100 / speed);
      intervalRef.current = setInterval(() => {
        onTickRef.current();
      }, ms);
    }
    return clear;
  }, [isPlaying, speed, clear]);
}
