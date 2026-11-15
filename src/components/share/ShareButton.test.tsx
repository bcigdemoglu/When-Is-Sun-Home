// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { encode } from "uqr";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useToasts } from "@/components/ui/toast";
import type { Place, PlaceSummary } from "@/lib/types";
import { searchParamsToSettings, searchParamsToSummary, useSettings } from "@/state";
import { ShareButton } from "./ShareButton";

const PLACE: Place = { lat: 37.7912, lng: -122.4301, name: "2550 Pacific Ave, San Francisco" };
const LABEL = "Pacific Ave backyard";
const SUMMARY: PlaceSummary = {
  year: 2026,
  avgSunHoursPerDay: 6.5,
  sunFraction: 0.54,
  totalSunHours: 2385,
  monthlySunHours: [0, 0.1, 6.1, 11.8, 12.7, 12.5, 12.6, 12.3, 8.6, 1.3, 0, 0],
  monthlyDaylightHours: [9.7, 10.7, 11.8, 13.1, 14.1, 14.6, 14.3, 13.4, 12.3, 11, 10, 9.4],
  bestMonth: 4,
  worstMonth: 0,
};
const S = "1.1t1i401u9.00011p3a3j3h3i3f2e0d0000.2p2z3a3n3x423z3q3f322s2m";

// ─── Browser stand-ins ─────────────────────────────────────────────────────

let coarsePointer = false;
const share = vi.fn<(data: ShareData) => Promise<void>>();
const writeText = vi.fn<(text: string) => Promise<void>>();
const execCommand = vi.fn<(command: string) => boolean>();

function setNavigator(key: "share" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, key, { configurable: true, value });
}

function abortError(): Error {
  return new DOMException("Share canceled", "AbortError");
}

beforeEach(() => {
  coarsePointer = false;
  share.mockReset().mockResolvedValue(undefined);
  writeText.mockReset().mockResolvedValue(undefined);
  execCommand.mockReset().mockReturnValue(true);
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("pointer: coarse") ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  setNavigator("share", share);
  setNavigator("clipboard", { writeText });
  document.execCommand = execCommand as unknown as typeof document.execCommand;
  window.history.replaceState(null, "", "/?old=1#report");

  useSettings.getState().reset();
  useSettings.getState().hydrate({
    place: PLACE,
    date: "2026-06-21",
    minuteOfDay: 15 * 60 + 40,
    observer: { mode: "window", heightM: 4.5, facingDeg: 180, fovDeg: 120 },
  });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderButton(
  overrides: Partial<React.ComponentProps<typeof ShareButton>> = {},
): HTMLElement {
  render(
    <ShareButton place={PLACE} label={LABEL} summary={SUMMARY} variant="pill" {...overrides} />,
  );
  return screen.getByRole("button", { name: "Share this report" });
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

const toastMessages = () => useToasts.getState().toasts.map((toast) => toast.message);
const urlField = () =>
  screen.getByRole<HTMLInputElement>("textbox", { name: "Link to this report" });
const paramsOf = (url: string) => new URL(url).searchParams;

// ─── The button itself ─────────────────────────────────────────────────────

describe("ShareButton", () => {
  test("pill: an icon and the word Share", () => {
    const button = renderButton({ variant: "pill", className: "my-class" });
    expect(button).toHaveTextContent("Share");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button).toHaveClass("my-class");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("icon: the icon only, named for screen readers", () => {
    const button = renderButton({ variant: "icon" });
    expect(button).toHaveTextContent("");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button).toHaveAccessibleName("Share this report");
  });

  test("the wrapper adds no box: className lays out the button as a direct child", () => {
    const button = renderButton();
    expect(button.parentElement).toHaveClass("contents");
  });
});

// ─── Phones: the system share sheet ────────────────────────────────────────

describe("native share (Web Share API + touch)", () => {
  beforeEach(() => {
    coarsePointer = true;
  });

  test("one tap shares title, text and a link that reproduces the view", async () => {
    await click(renderButton());

    expect(share).toHaveBeenCalledTimes(1);
    const data = share.mock.calls[0][0];
    expect(data.title).toBe("Pacific Ave backyard: 6.5 h of direct sun a day");
    expect(data.text).toBe(
      "Pacific Ave backyard: 6.5 h of direct sun on an average day (12.7 h in May, none in January). See the full year:",
    );
    // path and hash of the page are kept, its old query is not
    expect(data.url).toMatch(/^http:\/\/localhost(:\d+)?\/\?lat=/);
    expect(data.url).toMatch(/#report$/);
    expect(data.url).not.toContain("old=1");

    const params = paramsOf(data.url ?? "");
    expect(searchParamsToSettings(params)).toEqual({
      place: { lat: 37.7912, lng: -122.4301, name: LABEL },
      date: "2026-06-21",
      minuteOfDay: 940,
      observer: { mode: "window", heightM: 4.5, fovDeg: 120 },
    });
    expect(params.get("s")).toBe(S);
    expect(searchParamsToSummary(params)).toEqual(SUMMARY);

    // no popover, no copying, no toast
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual([]);
  });

  test("a live view is shared live: no day, no time", async () => {
    useSettings.getState().resetToNow();
    await click(renderButton());
    const params = paramsOf(share.mock.calls[0][0].url ?? "");
    expect(params.has("d")).toBe(false);
    expect(params.has("t")).toBe(false);
    expect(params.get("lat")).toBe("37.79120");
  });

  test("the link is built from the settings at the moment of the tap", async () => {
    const button = renderButton();
    act(() => useSettings.getState().setObserver({ fovDeg: 60 }));
    await click(button);
    expect(paramsOf(share.mock.calls[0][0].url ?? "").get("fov")).toBe("60");
  });

  test("while the numbers are still being computed it shares without them", async () => {
    await click(renderButton({ summary: null }));
    const data = share.mock.calls[0][0];
    expect(data.title).toBe("Pacific Ave backyard: see when this spot gets direct sun");
    expect(paramsOf(data.url ?? "").has("s")).toBe(false);
  });

  test("dismissing the sheet (AbortError) is not an error", async () => {
    share.mockRejectedValue(abortError());
    await click(renderButton());
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("any other failure copies the link and says so", async () => {
    share.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    await click(renderButton());
    await waitFor(() => expect(toastMessages()).toEqual(["Link copied"]));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(`&s=${S}`);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("…through the hidden-textarea fallback when the Clipboard API refuses", async () => {
    share.mockRejectedValue(new Error("boom"));
    writeText.mockRejectedValue(new DOMException("Not focused", "NotAllowedError"));
    let copied = "";
    execCommand.mockImplementation(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    const button = renderButton();
    button.focus();
    await click(button);
    await waitFor(() => expect(toastMessages()).toEqual(["Link copied"]));
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toContain("lat=37.79120");
    // the helper textarea is gone and focus is back where it was
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test("if nothing can copy either, the popover shows the link to copy by hand", async () => {
    share.mockRejectedValue(new Error("boom"));
    setNavigator("clipboard", undefined);
    execCommand.mockReturnValue(false);
    await click(renderButton());
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(urlField().value).toContain("lat=37.79120");
    expect(toastMessages()).toEqual([]);
  });

  test("a browser that says it cannot share this (canShare) is not asked to", async () => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
    try {
      await click(renderButton());
      expect(share).not.toHaveBeenCalled();
    } finally {
      delete (navigator as { canShare?: unknown }).canShare;
    }
  });
});

// ─── Everywhere else: the popover ──────────────────────────────────────────

describe("popover (desktop)", () => {
  test("a mouse-driven browser gets the popover even if it has navigator.share", async () => {
    await click(renderButton());
    expect(share).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Share this report" })).toBeInTheDocument();
  });

  test("no Web Share API at all: the popover", async () => {
    setNavigator("share", undefined);
    coarsePointer = true;
    await click(renderButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("opens as a labelled, non-modal dialog with focus on Copy", async () => {
    const button = renderButton();
    await click(button);

    const dialog = screen.getByRole("dialog", { name: "Share this report" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Copy link" }));
    // rendered at the top of the document, out of reach of clipping ancestors
    expect(dialog.parentElement).toBe(document.body);
  });

  test("shows a preview of the link card: label, viewpoint, the number, twelve bars", async () => {
    await click(renderButton());
    const preview = screen.getByTestId("share-preview");
    expect(preview).toHaveTextContent(LABEL);
    expect(preview).toHaveTextContent("Window · 2nd floor · facing S");
    expect(preview).toHaveTextContent("6.5h");
    expect(preview).toHaveTextContent("12.7 h in May · none in January");
    expect(preview.querySelectorAll("[aria-hidden] > div")).toHaveLength(12);
  });

  test("without a summary the preview invites instead", async () => {
    await click(renderButton({ summary: null }));
    expect(screen.getByTestId("share-preview")).toHaveTextContent(
      "See when this spot gets direct sun",
    );
    expect(urlField().value).not.toContain("&s=");
  });

  test("the link field is read-only, holds the full link and selects itself on focus", async () => {
    await click(renderButton());
    const field = urlField();
    expect(field).toHaveAttribute("readonly");
    const params = paramsOf(field.value);
    expect(params.get("n")).toBe(LABEL);
    expect(params.get("d")).toBe("2026-06-21");
    expect(params.get("t")).toBe("1540");
    expect(params.get("s")).toBe(S);
    expect(field.value).toMatch(/#report$/);

    fireEvent.focus(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  test("Copy puts the link on the clipboard and says 'Copied' for 2 seconds", async () => {
    vi.useFakeTimers();
    await click(renderButton());
    const copy = screen.getByRole("button", { name: "Copy link" });

    await click(copy);
    expect(writeText).toHaveBeenCalledWith(urlField().value);
    expect(copy).toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent("Link copied");
    // the popover's own feedback is enough: no toast on top of it
    expect(toastMessages()).toEqual([]);

    act(() => void vi.advanceTimersByTime(1999));
    expect(copy).toHaveTextContent("Copied");
    act(() => void vi.advanceTimersByTime(1));
    expect(copy).toHaveTextContent("Copy link");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  test("Copy falls back to execCommand where there is no Clipboard API", async () => {
    setNavigator("clipboard", undefined);
    let copied = "";
    execCommand.mockImplementation(() => {
      copied = (document.activeElement as HTMLTextAreaElement).value;
      return true;
    });
    await click(renderButton());
    const copy = screen.getByRole("button", { name: "Copy link" });
    await click(copy);
    expect(copied).toBe(urlField().value);
    expect(copy).toHaveTextContent("Copied");
  });

  test("when copying is impossible the link is selected and the user is told what to press", async () => {
    setNavigator("clipboard", undefined);
    execCommand.mockReturnValue(false);
    await click(renderButton());
    await click(screen.getByRole("button", { name: "Copy link" }));
    expect(screen.getByText(/press Ctrl\+C/)).toBeInTheDocument();
    expect(document.activeElement).toBe(urlField());
    expect(urlField().selectionEnd).toBe(urlField().value.length);
    expect(screen.getByRole("button", { name: "Copy link" })).toHaveTextContent("Copy link");
  });

  test("has a QR code of the link — without the summary, to keep the code coarse", async () => {
    await click(renderButton());
    const qr = screen.getByRole("img", { name: /QR code/ });
    expect(qr.tagName.toLowerCase()).toBe("svg");
    expect(screen.getByText("Open on your phone")).toBeInTheDocument();

    const full = urlField().value;
    const withoutSummary = full.replace(`&s=${S}`, "");
    expect(withoutSummary).not.toBe(full);
    const modules = Number(qr.getAttribute("data-modules"));
    expect(modules).toBe(encode(withoutSummary, { ecc: "L", border: 0 }).size);
    expect(modules).toBeLessThan(encode(full, { ecc: "L", border: 0 }).size);
  });

  describe("include the day and time", () => {
    const checkbox = () =>
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: "Include the day and time I’m looking at",
      });
    const qrPath = () =>
      screen
        .getByRole("img", { name: /QR code/ })
        .querySelector("path")
        ?.getAttribute("d");

    test("on by default when a day or time is pinned; unticking drops both from link and QR", async () => {
      await click(renderButton());
      expect(checkbox().checked).toBe(true);
      expect(screen.getByText("Opens on Sun, Jun 21 at 3:40 PM.")).toBeInTheDocument();
      const before = { url: urlField().value, qr: qrPath() };

      await click(checkbox());
      expect(checkbox().checked).toBe(false);
      const params = paramsOf(urlField().value);
      expect(params.has("d")).toBe(false);
      expect(params.has("t")).toBe(false);
      // everything else is untouched
      expect(params.get("m")).toBe("w");
      expect(params.get("s")).toBe(S);
      expect(urlField().value).not.toBe(before.url);
      expect(qrPath()).not.toBe(before.qr);
      expect(screen.getByText("Opens on the current day and time.")).toBeInTheDocument();

      await click(checkbox());
      expect(urlField().value).toBe(before.url);
      expect(qrPath()).toBe(before.qr);
    });

    test("off by default in a live view; ticking pins the place's current day and time", async () => {
      // 20:07 UTC on 14 Nov 2026 is 12:07 PM in San Francisco (PST).
      vi.useFakeTimers({ now: new Date("2026-11-14T20:07:30Z") });
      useSettings.getState().resetToNow();
      await click(renderButton());
      expect(checkbox().checked).toBe(false);
      expect(paramsOf(urlField().value).has("d")).toBe(false);

      await click(checkbox());
      const params = paramsOf(urlField().value);
      expect(params.get("d")).toBe("2026-11-14");
      expect(params.get("t")).toBe("1207");
      expect(screen.getByText("Opens on Sat, Nov 14 at 12:07 PM.")).toBeInTheDocument();
      // the store itself still follows the clock
      expect(useSettings.getState().date).toBeNull();
    });

    test("the copied link is the one on screen", async () => {
      await click(renderButton());
      await click(checkbox());
      await click(screen.getByRole("button", { name: "Copy link" }));
      expect(writeText).toHaveBeenCalledWith(urlField().value);
      expect(writeText.mock.calls[0][0]).not.toContain("d=2026");
    });
  });

  test("follows the settings while open", async () => {
    await click(renderButton());
    act(() => useSettings.getState().setObserver({ mode: "yard", heightM: 1 }));
    expect(screen.getByTestId("share-preview")).toHaveTextContent("Yard · ground");
    expect(paramsOf(urlField().value).has("m")).toBe(false);
  });

  describe("closing", () => {
    test("Escape closes and gives focus back to the button", async () => {
      const button = renderButton();
      await click(button);
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(button);
      expect(button).toHaveAttribute("aria-expanded", "false");
    });

    test("the close button does the same", async () => {
      const button = renderButton();
      await click(button);
      await click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(button);
    });

    test("a press outside closes it and leaves focus alone", async () => {
      render(<button type="button">elsewhere</button>);
      const button = renderButton();
      await click(button);
      const elsewhere = screen.getByRole("button", { name: "elsewhere" });
      await act(async () => {
        fireEvent.pointerDown(elsewhere);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).not.toBe(button);
    });

    test("a press inside does not close it", async () => {
      await click(renderButton());
      await act(async () => {
        fireEvent.pointerDown(urlField());
        fireEvent.pointerDown(screen.getByTestId("share-preview"));
      });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    test("the Share button toggles: a second click closes", async () => {
      const button = renderButton();
      await click(button);
      await act(async () => {
        fireEvent.pointerDown(button);
      });
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await click(button);
      expect(screen.queryByRole("dialog")).toBeNull();
      await click(button);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    test("unmounting the button removes the popover and its listeners", async () => {
      const { unmount } = render(
        <ShareButton place={PLACE} label={LABEL} summary={SUMMARY} variant="icon" />,
      );
      await click(screen.getByRole("button", { name: "Share this report" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      unmount();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(() => {
        fireEvent.pointerDown(document.body);
        fireEvent.keyDown(document.body, { key: "Escape" });
      }).not.toThrow();
    });
  });

  test("Tab cycles inside the popover", async () => {
    await click(renderButton());
    const dialog = screen.getByRole("dialog");
    const close = within(dialog).getByRole("button", { name: "Close" });
    const checkbox = within(dialog).getByRole("checkbox");

    checkbox.focus(); // the last control
    fireEvent.keyDown(checkbox, { key: "Tab" });
    expect(document.activeElement).toBe(close); // the first

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(checkbox);
  });

  test("is positioned by the button and made visible", async () => {
    const button = renderButton();
    button.getBoundingClientRect = () =>
      ({ top: 100, left: 40, width: 96, height: 44, right: 136, bottom: 144 }) as DOMRect;
    await click(button);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.visibility).toBe("visible");
    expect(dialog.style.top).toBe("152px"); // 144 + 8 gap
    expect(dialog.style.left).toBe("40px");
    expect(dialog.dataset.side).toBe("below");
  });
});
