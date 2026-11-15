import type { CDPSession, Page } from "@playwright/test";

/** Moves the map as a person would: a finger on the phone, a held mouse on the desktop. */
export class MapHand {
  private touch: CDPSession | null = null;

  constructor(
    private readonly page: Page,
    private readonly isPhone: boolean,
  ) {}

  /**
   * Drag the map so that what lies `dx` px to the right comes into view,
   * along a line near the map's top (clear of the pin, the search field and
   * the sheet).
   */
  async dragLeft(dx: number): Promise<void> {
    const box = (await this.page.locator(".maplibregl-canvas").boundingBox())!;
    const x = box.x + box.width - 16;
    const y = box.y + Math.min(260, box.height * 0.3);
    if (!this.isPhone) {
      await this.page.mouse.move(x, y);
      await this.page.mouse.down();
      await this.page.mouse.move(x - dx, y, { steps: 6 });
      await this.page.mouse.up();
      return;
    }
    this.touch ??= await this.page.context().newCDPSession(this.page);
    const at = (step: number) => [{ x: Math.round(x - (dx * step) / 6), y: Math.round(y) }];
    await this.touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (let step = 1; step <= 6; step++) {
      await this.touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(step),
      });
    }
    await this.touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  /** Keep dragging east, most of a screen at a time, until `seen()`. */
  async panEastUntil(seen: () => boolean): Promise<void> {
    const box = (await this.page.locator(".maplibregl-canvas").boundingBox())!;
    const dx = Math.round(box.width * 0.85);
    for (let drags = 0; drags < 40 && !seen(); drags++) {
      await this.dragLeft(dx);
      await this.page.waitForTimeout(150);
    }
  }
}
