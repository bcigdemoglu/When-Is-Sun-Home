// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
});
