import { expect, type Page } from "@playwright/test";
import { PageObject } from "./base";

/** What `navigator.share` was called with. */
export interface SharedData {
  title?: string;
  text?: string;
  url?: string;
}

interface ShareWindow {
  __shared?: SharedData[];
  __copied?: string[];
}

/**
 * Replace the system share sheet with a recorder. Call before the page
 * loads. `outcome` is what the fake sheet does: "shared" resolves, "dismissed"
 * rejects like a person closing the sheet, "broken" rejects with an error.
 */
export async function stubNativeShare(
  page: Page,
  outcome: "shared" | "dismissed" | "broken" = "shared",
): Promise<void> {
  await page.addInitScript((result) => {
    const store = window as unknown as { __shared?: unknown[] };
    store.__shared = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: unknown) => {
        store.__shared?.push(data);
        if (result === "dismissed") throw new DOMException("Share canceled", "AbortError");
        if (result === "broken") throw new DOMException("Not allowed", "NotAllowedError");
      },
    });
  }, outcome);
}

/** Replace the clipboard with a recorder (works without clipboard permissions). Call before the page loads. */
export async function stubClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __copied?: string[] };
    store.__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          store.__copied?.push(text);
        },
      },
    });
  });
}

/** Sharing: the system sheet on phones, a popover with link, Copy and QR code on desktop. */
export class SharePage extends PageObject {
  readonly button = this.page.getByRole("button", { name: "Share this report" });
  readonly popover = this.page.getByRole("dialog", { name: "Share this report" });
  readonly link = this.popover.getByRole("textbox", { name: "Link to this report" });
  readonly copy = this.popover.getByRole("button", { name: /^(Copy link|Copied)/ });
  readonly qrCode = this.popover.getByRole("img", { name: "QR code with the link to this report" });
  readonly includeDateTime = this.popover.getByRole("checkbox", {
    name: "Include the day and time I’m looking at",
  });
  readonly close = this.popover.getByRole("button", { name: "Close" });

  /** Everything the fake share sheet received so far. */
  async shared(): Promise<SharedData[]> {
    return this.page.evaluate(() => (window as unknown as ShareWindow).__shared ?? []);
  }

  /** Everything written to the fake clipboard so far. */
  async copied(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as ShareWindow).__copied ?? []);
  }

  /**
   * The link a person would send from here: taken from the share sheet on
   * phones (needs `stubNativeShare`), from the popover's field on desktop.
   */
  async currentLink(): Promise<string> {
    if (this.isPhone) {
      const before = (await this.shared()).length;
      await this.button.tap();
      await expect.poll(async () => (await this.shared()).length).toBe(before + 1);
      const url = (await this.shared())[before].url;
      if (!url) throw new Error("navigator.share was called without a url");
      return url;
    }
    if (!(await this.popover.isVisible())) await this.button.click();
    await expect(this.link).toHaveValue(/^http/);
    return this.link.inputValue();
  }
}

/** A share link's path and query, so it can be opened against the server under test. */
export function localPath(link: string): string {
  const url = new URL(link);
  return url.pathname + url.search + url.hash;
}
