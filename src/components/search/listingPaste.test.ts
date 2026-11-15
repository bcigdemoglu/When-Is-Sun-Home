// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "@/components/ui/toast";
import {
  CLIPBOARD_REFUSED_MESSAGE,
  NO_LINK_COPIED_MESSAGE,
  approximateMessage,
  armListingLink,
  arrivedWhole,
  canReadClipboard,
  disarmListingLink,
  handOffToSearch,
  readListingFromClipboard,
  settleListingLink,
  takeHandoff,
  useListingPaste,
} from "./listingPaste";

const ZILLOW =
  "https://www.zillow.com/homedetails/2220-Clay-St-San-Francisco-CA-94115/15075413_zpid/";
const KEY = "Zillow|2220 clay st san francisco, ca 94115";
const ZPID_ONLY = "https://www.zillow.com/homedetails/15075413_zpid/";

function stubClipboard(readText: (() => Promise<string>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: readText ? { readText } : undefined,
  });
}

const toasts = () => useToasts.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  useListingPaste.setState({ armed: null, handoff: null });
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  stubClipboard(undefined);
  vi.restoreAllMocks();
});

describe("arming a link that arrived whole", () => {
  it("arms a listing link with an address, and says what the text holds", () => {
    expect(armListingLink(`Look at this: ${ZILLOW}`)).toMatchObject({ kind: "address" });
    expect(useListingPaste.getState().armed).toEqual({ key: KEY, go: true });
  });

  it("arms nothing for a link without an address or for other text", () => {
    expect(armListingLink(ZPID_ONLY)).toMatchObject({ kind: "no-address" });
    expect(armListingLink("2220 Clay St")).toBeNull();
    expect(useListingPaste.getState().armed).toBeNull();
  });

  it("lets the lookup's answer open the place once — and only for that link", () => {
    armListingLink(ZILLOW);
    expect(settleListingLink("Zillow|another address")).toBe(false);
    expect(settleListingLink(KEY)).toBe(true);
    expect(settleListingLink(KEY)).toBe(false);
    // Still the link that gets the thorough lookup; it just no longer opens by itself.
    expect(useListingPaste.getState().armed).toEqual({ key: KEY, go: false });
  });

  it("pasting the same link again arms it again", () => {
    armListingLink(ZILLOW);
    settleListingLink(KEY);
    armListingLink(ZILLOW);
    expect(settleListingLink(KEY)).toBe(true);
  });

  it("forgets everything when search closes", () => {
    handOffToSearch(ZILLOW);
    disarmListingLink();
    expect(useListingPaste.getState()).toMatchObject({ armed: null, handoff: null });
    expect(settleListingLink(KEY)).toBe(false);
  });

  it("hands a link over to the search armed, and the hand-over is taken once", () => {
    handOffToSearch(ZILLOW);
    expect(useListingPaste.getState()).toMatchObject({
      armed: { key: KEY, go: true },
      handoff: { text: ZILLOW },
    });
    takeHandoff();
    expect(useListingPaste.getState().handoff).toBeNull();
    expect(useListingPaste.getState().armed).toEqual({ key: KEY, go: true });
  });
});

describe("arrivedWhole — pasted, not typed", () => {
  it("is true when a link lands in the field in one step", () => {
    expect(arrivedWhole("", ZILLOW)).toBe(true);
    // Over whatever was selected, in a sentence, or right behind typed text.
    expect(arrivedWhole("2140 Pacific Avenue, San Francisco", ZILLOW)).toBe(true);
    expect(arrivedWhole("", `Check out this home!\n${ZILLOW}`)).toBe(true);
    expect(arrivedWhole("pac", `pac${ZILLOW}`)).toBe(true);
  });

  it("is false for typing: the keystroke that completes a link is not a paste", () => {
    expect(arrivedWhole(ZILLOW.slice(0, -1), ZILLOW)).toBe(false);
    expect(arrivedWhole(ZILLOW, `${ZILLOW}?`)).toBe(false);
    expect(arrivedWhole(`${ZILLOW}x`, ZILLOW)).toBe(false);
  });

  it("is false when what arrived is no listing link with an address", () => {
    expect(arrivedWhole("", "2220 Clay St, San Francisco, CA 94115")).toBe(false);
    expect(arrivedWhole("", "https://example.com/some/long/path")).toBe(false);
    expect(arrivedWhole("", ZPID_ONLY)).toBe(false);
  });

  it("is false when the same listing was already there (its tracking tail pasted on)", () => {
    expect(arrivedWhole(ZILLOW, `${ZILLOW}?utm_source=txtshare`)).toBe(false);
  });

  it("is true when one listing's link replaces another's", () => {
    const other = ZILLOW.replace("2220", "2222");
    expect(arrivedWhole(ZILLOW, other)).toBe(false); // one character: typed
    expect(
      arrivedWhole(
        ZILLOW,
        "https://www.redfin.com/AL/Birmingham/2529-Comanche-Dr-35244/home/80696773",
      ),
    ).toBe(true);
  });
});

describe("the clipboard", () => {
  it("can be read only where the browser offers it", () => {
    stubClipboard(undefined);
    expect(canReadClipboard()).toBe(false);
    stubClipboard(async () => "");
    expect(canReadClipboard()).toBe(true);
  });

  it("gives back the copied text when it holds a listing link, trimmed, without a toast", async () => {
    stubClipboard(async () => `  ${ZILLOW}\n`);
    await expect(readListingFromClipboard()).resolves.toBe(ZILLOW);
    expect(toasts()).toEqual([]);
  });

  it("accepts a link without an address too: the search explains that one in place", async () => {
    stubClipboard(async () => ZPID_ONLY);
    await expect(readListingFromClipboard()).resolves.toBe(ZPID_ONLY);
  });

  it.each([
    ["nothing", ""],
    ["an address", "2220 Clay St, San Francisco"],
    ["some other link", "https://example.com/homes/1"],
  ])("says so when the clipboard holds %s", async (_what, copied) => {
    stubClipboard(async () => copied);
    await expect(readListingFromClipboard()).resolves.toBeNull();
    expect(toasts()).toEqual([NO_LINK_COPIED_MESSAGE]);
    expect(NO_LINK_COPIED_MESSAGE).toMatch(/Zillow, Redfin, Realtor\.com or Trulia/);
  });

  it("says how to go on when the browser refuses (permission denied, the Paste bubble dismissed)", async () => {
    stubClipboard(async () => {
      throw new DOMException("Read permission denied.", "NotAllowedError");
    });
    await expect(readListingFromClipboard()).resolves.toBeNull();
    expect(toasts()).toEqual([CLIPBOARD_REFUSED_MESSAGE]);
    expect(CLIPBOARD_REFUSED_MESSAGE).toMatch(/Paste the link into the search field/);
  });

  it("never rejects, even where there is no clipboard to ask", async () => {
    stubClipboard(undefined);
    await expect(readListingFromClipboard()).resolves.toBeNull();
    expect(toasts()).toEqual([CLIPBOARD_REFUSED_MESSAGE]);
  });
});

describe("approximateMessage", () => {
  it("names the address and says what to do", () => {
    expect(approximateMessage("212 Murray Lane")).toBe(
      "Near 212 Murray Lane: this house isn’t on the map yet. Drag the pin onto it.",
    );
  });
});
