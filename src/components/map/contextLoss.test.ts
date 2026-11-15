import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextLossWatch, shouldAutoRetry } from "./contextLoss";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(initiallyVisible = true) {
  let visible = initiallyVisible;
  const onGone = vi.fn();
  const watch = createContextLossWatch({ graceMs: 4000, isVisible: () => visible, onGone });
  const show = () => {
    visible = true;
    watch.visibilityChanged();
  };
  const hide = () => {
    visible = false;
    watch.visibilityChanged();
  };
  return { watch, onGone, show, hide };
}

describe("createContextLossWatch", () => {
  it("gives up when a context lost in plain sight stays lost for the grace period", () => {
    const { watch, onGone } = setup();
    watch.lost();
    vi.advanceTimersByTime(3999);
    expect(onGone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the context comes back in time", () => {
    const { watch, onGone } = setup();
    watch.lost();
    vi.advanceTimersByTime(1500);
    watch.restored();
    vi.advanceTimersByTime(60_000);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("does not count time while the page is hidden (a phone in a pocket)", () => {
    const { watch, onGone, show } = setup(false);
    watch.lost(); // lost in the background
    vi.advanceTimersByTime(8 * 60 * 60 * 1000); // all night
    expect(onGone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    show();
    // On return the browser restores the context a moment later: no error.
    vi.advanceTimersByTime(300);
    watch.restored();
    vi.advanceTimersByTime(60_000);
    expect(onGone).not.toHaveBeenCalled();
  });

  it("gives the browser a full grace period after the page comes back", () => {
    const { watch, onGone, show } = setup(false);
    watch.lost();
    show();
    vi.advanceTimersByTime(3999);
    expect(onGone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("pauses when the page is hidden mid-count and starts over on return", () => {
    const { watch, onGone, show, hide } = setup();
    watch.lost();
    vi.advanceTimersByTime(3000);
    hide();
    vi.advanceTimersByTime(60_000);
    expect(onGone).not.toHaveBeenCalled();
    show();
    vi.advanceTimersByTime(3000); // would have fired had the first 3 s counted
    expect(onGone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("ignores visibility changes while nothing is lost", () => {
    const { onGone, show, hide } = setup();
    hide();
    show();
    vi.advanceTimersByTime(60_000);
    expect(onGone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports each loss at most once, and can watch the next one", () => {
    const { watch, onGone } = setup();
    watch.lost();
    watch.lost(); // browsers may repeat the event
    vi.advanceTimersByTime(10_000);
    expect(onGone).toHaveBeenCalledTimes(1);
    watch.lost();
    vi.advanceTimersByTime(4000);
    expect(onGone).toHaveBeenCalledTimes(2);
  });

  it("stays silent once disposed", () => {
    const { watch, onGone, show } = setup(false);
    watch.lost();
    watch.dispose();
    show();
    vi.advanceTimersByTime(60_000);
    expect(onGone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("shouldAutoRetry", () => {
  it("retries a failed map once, when the page is visible", () => {
    expect(shouldAutoRetry({ failed: true, visible: true, alreadyRetried: false })).toBe(true);
    expect(shouldAutoRetry({ failed: true, visible: false, alreadyRetried: false })).toBe(false);
    expect(shouldAutoRetry({ failed: true, visible: true, alreadyRetried: true })).toBe(false);
    expect(shouldAutoRetry({ failed: false, visible: true, alreadyRetried: false })).toBe(false);
  });
});
