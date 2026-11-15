// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_DURATION_MS, showToast, useToasts } from "./toast";
import { Toaster } from "./Toaster";

beforeEach(() => {
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("is a polite live region that shows what showToast raises", () => {
    render(<Toaster />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    act(() => {
      showToast("Link copied");
    });
    expect(region).toHaveTextContent("Link copied");
  });

  it("runs a toast's action and dismisses it", async () => {
    const onAction = vi.fn();
    render(<Toaster />);
    act(() => {
      showToast("Saved as “Elm St backyard”", { label: "Rename", onAction });
    });
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("lets toasts expire on their own", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      showToast("Link copied");
    });
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10);
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("says when it is shown inside a modal, so the shell can place it there", async () => {
    const dialog = document.createElement("dialog");
    // jsdom has no `showModal()`: an open dialog stands in for a modal one.
    vi.spyOn(dialog, "matches").mockImplementation((selector: string) =>
      selector === ":modal"
        ? dialog.hasAttribute("open")
        : Element.prototype.matches.call(dialog, selector),
    );
    document.body.append(dialog);
    render(<Toaster className="fixed" />);
    expect(screen.getByRole("status")).not.toHaveAttribute("data-in-modal");

    act(() => {
      dialog.setAttribute("open", "");
    });
    await waitFor(() => expect(dialog.querySelector("[data-toaster]")).not.toBeNull());
    expect(dialog.querySelector("[data-toaster]")).toHaveAttribute("data-in-modal");

    act(() => {
      dialog.removeAttribute("open");
    });
    await waitFor(() => expect(dialog.querySelector("[data-toaster]")).toBeNull());
    expect(screen.getByRole("status")).not.toHaveAttribute("data-in-modal");
    dialog.remove();
  });

  it("shows a toast as a solid surface (no fade classes)", () => {
    render(<Toaster />);
    act(() => {
      showToast("Link copied");
    });
    const pill = screen.getByText("Link copied").parentElement!;
    expect(pill.className).toContain("bg-ink");
    expect(pill.className).toContain("opacity-100");
    expect(pill.className).not.toMatch(/bg-ink\/|backdrop-blur/);
  });
});
