// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaces } from "@/state/places";
import { HomeScreenHint } from "./HomeScreenHint";
import {
  HOME_SCREEN_HINT_KEY,
  homeScreenHintText,
  iosDevice,
  isStandalone,
  resetHomeScreenHintForTests,
  shouldShowHomeScreenHint,
} from "./homeScreenHint";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

const TEXT =
  "On iPhone, add this app to your Home Screen (Share › Add to Home Screen) so Safari keeps your saved places.";

function browser(facts: {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}) {
  vi.stubGlobal("navigator", { platform: "", maxTouchPoints: 5, ...facts });
}

function savePlaces(count: number) {
  const saved = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    lat: 37.79 + i / 1000,
    lng: -122.43,
    label: `Place ${i}`,
  }));
  act(() => {
    usePlaces.setState({ saved } as unknown as Partial<ReturnType<typeof usePlaces.getState>>);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  resetHomeScreenHintForTests();
  usePlaces.setState({ saved: [], recent: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("shouldShowHomeScreenHint", () => {
  const yes = { isIosSafari: true, standalone: false, savedCount: 1, dismissed: false };
  it("needs iOS Safari, a browser tab, a saved place, and no earlier dismissal", () => {
    expect(shouldShowHomeScreenHint(yes)).toBe(true);
    expect(shouldShowHomeScreenHint({ ...yes, isIosSafari: false })).toBe(false);
    expect(shouldShowHomeScreenHint({ ...yes, standalone: true })).toBe(false);
    expect(shouldShowHomeScreenHint({ ...yes, savedCount: 0 })).toBe(false);
    expect(shouldShowHomeScreenHint({ ...yes, dismissed: true })).toBe(false);
  });
});

describe("the facts about the device", () => {
  it("names the device in hand", () => {
    expect(iosDevice({ userAgent: IPHONE_SAFARI })).toBe("iPhone");
    expect(iosDevice({ userAgent: IPAD_SAFARI, platform: "MacIntel", maxTouchPoints: 5 })).toBe(
      "iPad",
    );
    expect(iosDevice({ userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)" })).toBe("iPad");
    expect(homeScreenHintText("iPhone")).toBe(TEXT);
    expect(homeScreenHintText("iPad")).toBe(TEXT.replace("iPhone", "iPad"));
  });

  it("knows a Home Screen app by either sign", () => {
    expect(isStandalone({ standalone: true })).toBe(true);
    expect(isStandalone({}, () => ({ matches: true }))).toBe(true);
    expect(isStandalone({ standalone: false }, () => ({ matches: false }))).toBe(false);
    expect(isStandalone({})).toBe(false);
    expect(
      isStandalone({}, () => {
        throw new Error("no matchMedia");
      }),
    ).toBe(false);
  });
});

describe("HomeScreenHint", () => {
  it("shows the tip in Safari on an iPhone once a place is saved", () => {
    browser({ userAgent: IPHONE_SAFARI });
    render(<HomeScreenHint />);
    expect(screen.queryByRole("note")).toBeNull();
    savePlaces(1);
    expect(screen.getByRole("note")).toHaveTextContent(TEXT);
  });

  it("says iPad on an iPad", () => {
    browser({ userAgent: IPAD_SAFARI, platform: "MacIntel", maxTouchPoints: 5 });
    savePlaces(2);
    render(<HomeScreenHint />);
    expect(screen.getByRole("note")).toHaveTextContent(/^On iPad, add this app/);
  });

  it("stays away when the app already runs from the Home Screen", () => {
    browser({ userAgent: IPHONE_SAFARI, standalone: true });
    savePlaces(1);
    render(<HomeScreenHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("stays away in display-mode standalone too", () => {
    browser({ userAgent: IPHONE_SAFARI });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(display-mode: standalone)",
    }));
    savePlaces(1);
    render(<HomeScreenHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("stays away everywhere else: other iOS browsers, Android, desktop", () => {
    savePlaces(1);
    for (const userAgent of [IPHONE_CHROME, ANDROID]) {
      browser({ userAgent });
      const { unmount } = render(<HomeScreenHint />);
      expect(screen.queryByRole("note")).toBeNull();
      unmount();
    }
    // A real Mac: same UA as an iPad, but no touch screen.
    browser({ userAgent: IPAD_SAFARI, platform: "MacIntel", maxTouchPoints: 0 });
    render(<HomeScreenHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("goes away for good when dismissed", async () => {
    browser({ userAgent: IPHONE_SAFARI });
    savePlaces(1);
    const { unmount } = render(<HomeScreenHint />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss this tip" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(window.localStorage.getItem(HOME_SCREEN_HINT_KEY)).not.toBeNull();

    // A later visit: only the stored flag is left.
    unmount();
    resetHomeScreenHintForTests();
    render(<HomeScreenHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("can still be dismissed for the visit when storage is blocked", async () => {
    browser({ userAgent: IPHONE_SAFARI });
    savePlaces(1);
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<HomeScreenHint />);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss this tip" }));
    expect(screen.queryByRole("note")).toBeNull();
    blocked.mockRestore();
  });
});
