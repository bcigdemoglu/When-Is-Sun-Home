import { test, expect } from "@playwright/test";

test("mobile sidebar cards have transparent backgrounds", async ({ page }) => {
  await page.goto("/");

  // Open the sidebar via the burger button
  const burger = page.getByLabel("Open settings");
  await expect(burger).toBeVisible();
  await burger.click();

  // Wait for the slide-in transition (300ms) to complete
  await page.waitForTimeout(400);

  // Verify sidebar is visible
  const sidebar = page.locator(".sidebar-glass");
  await expect(sidebar).toBeVisible();

  // Programmatic check: direct children should have transparent backgrounds
  const styles = await page.evaluate(() => {
    const container = document.querySelector(".sidebar-glass");
    if (!container) return null;

    const children = Array.from(container.children);
    return children.map((child) => {
      const cs = getComputedStyle(child);
      return {
        backgroundColor: cs.backgroundColor,
        boxShadow: cs.boxShadow,
      };
    });
  });

  expect(styles).not.toBeNull();
  expect(styles!.length).toBeGreaterThan(0);

  for (const style of styles!) {
    // backgroundColor should be transparent (rgba with alpha 0)
    const bg = style.backgroundColor;
    const isTransparent =
      bg === "transparent" ||
      bg === "rgba(0, 0, 0, 0)" ||
      /rgba\(\d+,\s*\d+,\s*\d+,\s*0\)/.test(bg);
    expect(isTransparent).toBe(true);

    // boxShadow should be none
    expect(style.boxShadow).toBe("none");
  }

  // Take a screenshot for visual review
  await page.screenshot({ path: "tests/mobile-sidebar.png", fullPage: false });
});
