import { expect, type Locator } from "@playwright/test";
import { PageObject } from "./base";

export type Facing =
  "north" | "north-east" | "east" | "south-east" | "south" | "south-west" | "west" | "north-west";

/** Who is looking: a yard, or a window on some floor facing some way. A dialog on phones, a fold-out section on desktop. */
export class ViewpointPage extends PageObject {
  /** Opens the controls. Its name carries the current viewpoint in words. */
  readonly toggle = this.isPhone
    ? this.page.getByRole("button", { name: /^Viewpoint: .*\. Change$/ })
    : this.page.getByRole("button", { name: /^Viewpoint / });
  readonly dialog = this.page.getByRole("dialog", { name: "Viewpoint" });
  /** Where the controls are. */
  readonly panel: Locator = this.isPhone
    ? this.dialog
    : this.page.locator("section").filter({ has: this.toggle });
  readonly mode = this.panel.getByRole("radiogroup", { name: "Viewpoint type" });
  readonly floor = this.panel.getByRole("group", { name: "Floor" });
  readonly floorName = this.floor.getByRole("status");
  readonly floorUp = this.floor.getByRole("button", { name: "One floor up" });
  readonly floorDown = this.floor.getByRole("button", { name: "One floor down" });
  readonly facing = this.panel.getByRole("group", { name: "Facing direction" });
  readonly facingSlider = this.panel.getByRole("slider", { name: "Facing, in degrees" });
  readonly fieldOfView = this.panel.getByRole("radiogroup", { name: "Field of view" });
  readonly fieldOfViewSlider = this.panel.getByRole("slider", {
    name: "Field of view, in degrees",
  });
  readonly height = this.panel.getByRole("slider", { name: "Height above ground" });
  readonly heightPresets = this.panel.getByRole("group", { name: "Height presets" });
  readonly reset = this.panel.getByRole("button", { name: "Reset viewpoint" });
  /** "The pin is on top of a building footprint…" */
  readonly pinOnBuildingWarning = this.panel
    .getByRole("alert")
    .filter({ hasText: "The pin is on top of a building footprint" });

  async open(): Promise<void> {
    if (this.isPhone) {
      if (!(await this.dialog.isVisible())) await this.toggle.tap();
      await expect(this.dialog).toBeVisible();
    } else {
      if ((await this.toggle.getAttribute("aria-expanded")) !== "true") await this.toggle.click();
      await expect(this.toggle).toHaveAttribute("aria-expanded", "true");
    }
  }

  /** Phones: put the dialog away so the answer is visible again. Desktop: nothing to do. */
  async close(): Promise<void> {
    if (!this.isPhone) return;
    await this.dialog.getByRole("button", { name: "Close" }).tap();
    await expect(this.dialog).toBeHidden();
  }

  async chooseMode(mode: "Yard / open air" | "Window"): Promise<void> {
    await this.chooseSegment(this.mode, mode);
  }

  async face(direction: Facing): Promise<void> {
    const button = this.facing.getByRole("button", { name: `Face ${direction}`, exact: true });
    await this.press(button);
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
}
