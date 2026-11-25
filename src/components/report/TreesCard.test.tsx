// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreesCard } from "./TreesCard";

/** An IntersectionObserver the test drives: `show()` brings every observed element into view. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  show() {
    this.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function renderCard(place: { lat: number; lng: number; name?: string }) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TreesCard place={place} />
    </QueryClientProvider>,
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  // Every request hangs: what matters here is whether one is made.
  fetchSpy = vi.fn(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TreesCard", () => {
  it("asks for nothing until it is scrolled into view, then asks the city", async () => {
    renderCard({ lat: 45.5382208, lng: -122.6257477, name: "2124 NE 36th Ave" });
    expect(screen.getByRole("heading", { level: 2, name: "Trees" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => FakeIntersectionObserver.instances.forEach((o) => o.show()));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const hosts = new Set(fetchSpy.mock.calls.map(([url]) => new URL(String(url)).hostname));
    for (const host of hosts) {
      expect(["www.portlandmaps.com", "gis.dogami.oregon.gov", "tiles.openfreemap.org"]).toContain(
        host,
      );
    }
    // Four separate parts, each with its own heading.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "In front, on the street",
      "Backyard",
      "This block",
      "The area",
    ]);
    expect(screen.getByText(/Trees are not part of the sun hours/)).toBeInTheDocument();
  });

  it("says where tree data exists, and asks nothing, outside Oregon", async () => {
    renderCard({ lat: 37.7912, lng: -122.4301 });
    await act(async () => FakeIntersectionObserver.instances.forEach((o) => o.show()));
    expect(screen.getByText(/only available in Oregon/)).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
