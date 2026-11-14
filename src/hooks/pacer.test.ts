import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPacer, type Settle } from "./pacer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A consumer that takes `costMs` to show each emission. */
function consumer(costMs: () => number) {
  const emits: number[] = [];
  const settle: Settle = (done) => {
    const timer = setTimeout(done, costMs());
    return () => clearTimeout(timer);
  };
  return { emits, settle, onEmit: () => emits.push(Date.now()) };
}

const base = { minIntervalMs: 30, loadFactor: 3, allowanceMs: 40, now: () => Date.now() };

/** Request a new value every `everyMs` for `totalMs`. */
function stream(request: () => void, everyMs: number, totalMs: number) {
  for (let t = 0; t < totalMs; t += everyMs) {
    request();
    vi.advanceTimersByTime(everyMs);
  }
}

describe("createPacer", () => {
  it("emits the first request on the next task", () => {
    const { emits, settle, onEmit } = consumer(() => 10);
    const pacer = createPacer({ ...base, onEmit, settle });
    pacer.request();
    expect(emits).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(emits).toEqual([0]);
  });

  it("runs at the maximum rate while the consumer is cheap", () => {
    const { emits, settle, onEmit } = consumer(() => 20); // within the allowance
    const pacer = createPacer({ ...base, onEmit, settle });
    stream(() => pacer.request(), 5, 600);
    // One emission per 30 ms: about 20 in 600 ms.
    expect(emits.length).toBeGreaterThanOrEqual(18);
    expect(emits.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < emits.length; i++) expect(emits[i] - emits[i - 1]).toBeGreaterThanOrEqual(30);
  });

  it("backs off in proportion to what the consumer costs", () => {
    const { emits, settle, onEmit } = consumer(() => 160); // 120 ms over the allowance
    const pacer = createPacer({ ...base, onEmit, settle });
    stream(() => pacer.request(), 5, 3000);
    // Each cycle: 160 ms of work + 3 × 120 ms of rest = 520 ms.
    for (let i = 1; i < emits.length; i++) expect(emits[i] - emits[i - 1]).toBeGreaterThanOrEqual(520);
    expect(emits.length).toBeGreaterThanOrEqual(5);
    expect(emits.length).toBeLessThanOrEqual(6);
    // So the consumer is busy for under a third of the time.
    expect((emits.length * 160) / 3000).toBeLessThan(0.34);
  });

  it("never emits while the consumer is still busy", () => {
    let settled: (() => void) | null = null;
    const emits: number[] = [];
    const pacer = createPacer({
      ...base,
      onEmit: () => emits.push(Date.now()),
      settle: (done) => {
        settled = done;
        return () => {};
      },
    });
    pacer.request();
    vi.advanceTimersByTime(0);
    stream(() => pacer.request(), 10, 5000);
    expect(emits).toHaveLength(1);
    settled!();
    vi.advanceTimersByTime(1000);
    expect(emits).toHaveLength(2);
  });

  it("always delivers the last request, and nothing more once it is quiet", () => {
    const { emits, settle, onEmit } = consumer(() => 160);
    const pacer = createPacer({ ...base, onEmit, settle });
    stream(() => pacer.request(), 5, 400);
    const during = emits.length;
    vi.advanceTimersByTime(5000);
    expect(emits.length).toBe(during + 1);
    vi.advanceTimersByTime(5000);
    expect(emits.length).toBe(during + 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers its speed when the consumer gets cheap again", () => {
    let cost = 300;
    const { emits, settle, onEmit } = consumer(() => cost);
    const pacer = createPacer({ ...base, onEmit, settle });
    stream(() => pacer.request(), 5, 2000);
    cost = 10;
    vi.advanceTimersByTime(2000); // let the last slow cycle finish
    const before = emits.length;
    stream(() => pacer.request(), 5, 300);
    expect(emits.length - before).toBeGreaterThanOrEqual(8);
  });

  it("caps the rest after a single very slow emission", () => {
    const { emits, settle, onEmit } = consumer(() => 5000);
    const pacer = createPacer({ ...base, maxRestMs: 1000, onEmit, settle });
    pacer.request();
    vi.advanceTimersByTime(0);
    pacer.request();
    vi.advanceTimersByTime(5000 + 1000);
    expect(emits).toHaveLength(2);
  });

  it("stops for good when disposed, even mid-emission", () => {
    const { emits, settle, onEmit } = consumer(() => 100);
    const pacer = createPacer({ ...base, onEmit, settle });
    pacer.request();
    vi.advanceTimersByTime(0);
    pacer.request();
    pacer.dispose();
    vi.advanceTimersByTime(10_000);
    expect(emits).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
