"use client";

import { useEffect, useRef, useState } from "react";
import { createPacer, settleAfterTwoFrames, type Pacer, type Settle } from "./pacer";

export interface PacedValueOptions {
  /** Never update more often than this, ms. */
  minIntervalMs: number;
  /** Rest after an update, as a multiple of what it cost beyond the allowance. */
  loadFactor?: number;
  /** Cost that counts as free, ms. */
  allowanceMs?: number;
  /**
   * When is an update "on screen"? Default: two animation frames later. Give
   * the consumer's own signal when it finishes asynchronously (a map that
   * re-tiles in a worker, say).
   */
  settle?: Settle;
}

/**
 * `value`, delivered no faster than whoever consumes it can show it (see
 * `pacer.ts`). Use it between a fast-changing source — a slider being dragged,
 * the play animation — and an expensive consumer: the consumer skips
 * intermediate values instead of queueing them, and always ends on the last.
 */
export function usePacedValue<T>(value: T, options: PacedValueOptions): T {
  const { minIntervalMs, loadFactor = 3, allowanceMs = 40, settle } = options;
  const [paced, setPaced] = useState(value);
  const latest = useRef(value);
  const settleRef = useRef(settle);
  const pacerRef = useRef<Pacer | null>(null);

  useEffect(() => {
    settleRef.current = settle;
  }, [settle]);

  useEffect(() => {
    const pacer = createPacer({
      minIntervalMs,
      loadFactor,
      allowanceMs,
      onEmit: () => setPaced(latest.current),
      settle: (done) => (settleRef.current ?? settleAfterTwoFrames)(done),
    });
    pacerRef.current = pacer;
    return () => {
      pacer.dispose();
      pacerRef.current = null;
    };
  }, [minIntervalMs, loadFactor, allowanceMs]);

  useEffect(() => {
    latest.current = value;
    pacerRef.current?.request();
  }, [value]);

  return paced;
}
