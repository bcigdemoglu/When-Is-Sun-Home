import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTileRefreshWatch, shouldRefreshTiles } from "./tileRefresh";

describe("shouldRefreshTiles", () => {
  const ready = { failed: true, allowed: true, visible: true, online: true };

  it("says yes only when a tile failed, a try is left, and the page can load anything", () => {
    expect(shouldRefreshTiles(ready)).toBe(true);
    expect(shouldRefreshTiles({ ...ready, failed: false })).toBe(false);
    expect(shouldRefreshTiles({ ...ready, allowed: false })).toBe(false);
    expect(shouldRefreshTiles({ ...ready, visible: false })).toBe(false);
    expect(shouldRefreshTiles({ ...ready, online: false })).toBe(false);
  });
});

describe("createTileRefreshWatch", () => {
  let visible = true;
  let online = true;
  let refresh: ReturnType<typeof vi.fn<() => void>>;
  const DELAY = 1000;
  const watch = () =>
    createTileRefreshWatch({
      delayMs: DELAY,
      isVisible: () => visible,
      isOnline: () => online,
      refresh,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    visible = true;
    online = true;
    refresh = vi.fn<() => void>();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing while no tile has failed", () => {
    const tiles = watch();
    tiles.woke();
    vi.advanceTimersByTime(10 * DELAY);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks again a moment after a failure — once, however many tiles failed", () => {
    const tiles = watch();
    tiles.failed();
    tiles.failed();
    tiles.failed();
    vi.advanceTimersByTime(DELAY - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not loop while the tiles keep failing with the page in view", () => {
    const tiles = watch();
    tiles.failed();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The second attempt fails as well: that was the one try.
    tiles.failed();
    vi.advanceTimersByTime(60 * DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("gets one more try each time the page wakes up", () => {
    const tiles = watch();
    tiles.failed();
    vi.advanceTimersByTime(DELAY);
    tiles.failed();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);

    tiles.woke();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(2);
    // Nothing failed since: waking up again is no reason to reload.
    tiles.woke();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits for the page to be looked at: a phone cuts requests off in the background", () => {
    const tiles = watch();
    visible = false;
    tiles.failed();
    vi.advanceTimersByTime(60 * DELAY);
    expect(refresh).not.toHaveBeenCalled();

    visible = true;
    tiles.woke();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("works when the failures arrive after the wake-up (requests die on resume)", () => {
    const tiles = watch();
    tiles.failed();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);

    visible = false;
    vi.advanceTimersByTime(5 * DELAY);
    visible = true;
    tiles.woke();
    vi.advanceTimersByTime(200);
    tiles.failed();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("waits for the connection to come back", () => {
    const tiles = watch();
    online = false;
    tiles.failed();
    vi.advanceTimersByTime(60 * DELAY);
    expect(refresh).not.toHaveBeenCalled();

    online = true;
    tiles.woke();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh if the page went away again during the delay", () => {
    const tiles = watch();
    tiles.failed();
    vi.advanceTimersByTime(DELAY / 2);
    visible = false;
    vi.advanceTimersByTime(DELAY);
    expect(refresh).not.toHaveBeenCalled();
    // The try was not spent: it happens on return.
    visible = true;
    tiles.woke();
    vi.advanceTimersByTime(DELAY);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops for good once disposed", () => {
    const tiles = watch();
    tiles.failed();
    tiles.dispose();
    vi.advanceTimersByTime(10 * DELAY);
    tiles.woke();
    tiles.failed();
    vi.advanceTimersByTime(10 * DELAY);
    expect(refresh).not.toHaveBeenCalled();
  });
});
