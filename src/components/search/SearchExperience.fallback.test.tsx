// @vitest-environment jsdom
/**
 * The search experience on top of the REAL search hook, with only `fetch`
 * replaced: what the user sees when Photon cannot be reached, and that the
 * second service (Nominatim) is only ever asked on an explicit submit.
 * No test here — or anywhere — talks to the real services.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetNominatimLimiter } from "@/lib/geocode/nominatim";
import {
  PHOTON_COOL_DOWN_MS,
  getPhotonHealth,
  resetPhotonHealth,
} from "@/lib/geocode/photonHealth";
import { usePlaces } from "@/state/places";
import { SearchExperience } from "./SearchExperience";
import type { SearchExperienceProps } from "./types";

const NOTE = "Live suggestions are unavailable right now. Press Enter to search.";
/** A response captured from nominatim.openstreetmap.org. */
const NOMINATIM_SEARCH = readFileSync(
  path.resolve(process.cwd(), "src/lib/geocode/__fixtures__/nominatim-search.json"),
  "utf8",
);

// The clipboard row is another test's subject: here the list is as it is without it.
vi.mock("./listingPaste", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./listingPaste")>()),
  canReadClipboard: () => false,
}));

function photonBody(name: string): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { osm_type: "W", osm_id: 1, name, city: "Liveville" },
        geometry: { type: "Point", coordinates: [10, 50] },
      },
    ],
  });
}

type Handler = (url: URL) => Promise<Response>;
const failing: Handler = async () => {
  throw new TypeError("Failed to fetch");
};
const photonUp: Handler = async (url) =>
  new Response(photonBody(`${url.searchParams.get("q")} live`));
const nominatimUp: Handler = async () => new Response(NOMINATIM_SEARCH);

let calls: { photon: string[]; nominatim: string[] };

function services(photon: Handler, nominatim: Handler) {
  calls = { photon: [], nominatim: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input as string);
      const q = url.searchParams.get("q") ?? "";
      if (url.hostname === "photon.komoot.io") {
        calls.photon.push(q);
        return photon(url);
      }
      if (url.hostname === "nominatim.openstreetmap.org") {
        calls.nominatim.push(q);
        return nominatim(url);
      }
      throw new Error(`a test tried to reach ${url.hostname}`);
    }),
  );
}

function setup(props: Partial<SearchExperienceProps> = {}) {
  const onSelect = vi.fn();
  const onChooseOnMap = vi.fn();
  const user = userEvent.setup();
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <SearchExperience
        variant="overlay"
        place={null}
        onSelect={onSelect}
        onChooseOnMap={onChooseOnMap}
        onClear={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSelect, onChooseOnMap, user };
}

const open = async (user: ReturnType<typeof userEvent.setup>, variant = "overlay") => {
  if (variant === "overlay") {
    await user.click(screen.getByRole("button", { name: /^search an address/i }));
  } else {
    await user.click(screen.getByRole("combobox"));
  }
};
const note = () => screen.findByText(NOTE, undefined, { timeout: 4000 });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  localStorage.clear();
  usePlaces.setState({ saved: [], recent: [] });
  resetPhotonHealth();
  resetNominatimLimiter();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("search when Photon is down", () => {
  it("switches to submit mode: a note and a Search row instead of an error", async () => {
    services(failing, nominatimUp);
    const { user } = setup();
    await open(user);
    await user.keyboard("2550 pacific");
    // Skeleton rows while the live search is tried (and retried once)…
    expect(await screen.findByTestId("search-skeleton")).toBeInTheDocument();
    // …then, quietly, the other way to search.
    expect(await note()).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Search for 2550 pacific" })).toBeInTheDocument();
    expect(screen.queryByTestId("search-skeleton")).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn’t search/i)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /use my current location/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /choose on the map/i })).toBeInTheDocument();
    expect(calls.photon).toEqual(["2550 pacific", "2550 pacific"]);
    expect(calls.nominatim).toEqual([]);
  });

  it("sends nothing per keystroke while in submit mode", async () => {
    services(failing, nominatimUp);
    const { user } = setup();
    await open(user);
    await user.keyboard("2550");
    await note();
    calls.photon.length = 0;
    await user.keyboard(" pacific avenue san francisco");
    await pause(700);
    expect(calls.photon).toEqual([]);
    expect(calls.nominatim).toEqual([]);
    // The Search row follows the text.
    expect(
      screen.getByRole("option", { name: "Search for 2550 pacific avenue san francisco" }),
    ).toBeInTheDocument();
  });

  it("Enter runs exactly one Nominatim search and lists its results, which can be picked", async () => {
    services(failing, nominatimUp);
    const { user, onSelect } = setup();
    await open(user);
    await user.keyboard("2550 pacific avenue");
    await note();
    await user.keyboard("{Enter}");
    const option = await screen.findByRole("option", {
      name: "2550 Pacific Avenue, San Francisco, California, United States",
    });
    expect(calls.nominatim).toEqual(["2550 pacific avenue"]);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.getByTestId("search-attribution")).toHaveTextContent(
      "Search by Photon / Nominatim · © OpenStreetMap contributors",
    );
    // Pressing Enter again picks the result; it does not search again.
    await user.keyboard("{Enter}");
    expect(calls.nominatim).toHaveLength(1);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: {
        lat: 37.7931118,
        lng: -122.4372316,
        name: "2550 Pacific Avenue, San Francisco, California, United States",
      },
      source: "search",
    });
    expect(option).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("tapping the Search row searches too, and a result can be tapped", async () => {
    services(failing, nominatimUp);
    const { user, onSelect } = setup();
    await open(user);
    await user.keyboard("2550 pacific avenue");
    await note();
    await user.click(screen.getByRole("option", { name: /^search for/i }));
    await user.click(await screen.findByRole("option", { name: /^2550 Pacific Avenue/ }));
    expect(calls.nominatim).toEqual(["2550 pacific avenue"]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ source: "search" });
  });

  it("changing the text asks for another submit; each submit is one request", async () => {
    services(failing, nominatimUp);
    const { user } = setup();
    await open(user);
    await user.keyboard("2550 pacific");
    await note();
    await user.keyboard("{Enter}");
    await screen.findByRole("option", { name: /^2550 Pacific Avenue/ });
    await user.keyboard(" ave");
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^2550 Pacific Avenue/ })).not.toBeInTheDocument();
    await pause(500);
    expect(calls.nominatim).toEqual(["2550 pacific"]);
    resetNominatimLimiter();
    await user.keyboard("{Enter}");
    await screen.findByRole("option", { name: /^2550 Pacific Avenue/ });
    expect(calls.nominatim).toEqual(["2550 pacific", "2550 pacific ave"]);
  });

  it("saved places, coordinates and the two actions keep working", async () => {
    usePlaces
      .getState()
      .save(
        { lat: 37.75, lng: -122.43, name: "412 Elm Street, Noe Valley" },
        { mode: "yard", heightM: 1, facingDeg: 180, fovDeg: 180 },
        null,
      );
    services(failing, nominatimUp);
    const { user, onSelect, onChooseOnMap } = setup();
    await open(user);
    await user.keyboard("elm street");
    await note();
    expect(screen.getByRole("option", { name: /^412 Elm Street/ })).toBeInTheDocument();

    await user.clear(screen.getByRole("combobox"));
    await user.keyboard("37.79, -122.43");
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      place: { lat: 37.79, lng: -122.43 },
      source: "coordinates",
    });

    await open(user);
    await user.click(screen.getByRole("option", { name: /choose on the map/i }));
    expect(onChooseOnMap).toHaveBeenCalledTimes(1);
    expect(calls.nominatim).toEqual([]);
  });

  it("both services down: the inline error, Try again (one request), and the two rows", async () => {
    services(failing, failing);
    const { user } = setup();
    await open(user);
    await user.keyboard("lombard st");
    await note();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Couldn’t search — check your connection.")).toBeInTheDocument();
    expect(calls.nominatim).toEqual(["lombard st"]);
    expect(screen.queryByTestId("search-skeleton")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);

    // Trying again while Nominatim is back shows the results.
    resetNominatimLimiter();
    services(failing, nominatimUp);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("option", { name: /^2550 Pacific Avenue/ })).toBeInTheDocument();
    expect(calls.nominatim).toEqual(["lombard st"]);
  });

  it("returns to live suggestions, silently, once Photon answers after the cool-down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    services(failing, nominatimUp);
    const { user } = setup();
    await open(user);
    await user.keyboard("lombard");
    await note();
    expect(getPhotonHealth()).toBe("down");

    // Photon is back, but the cool-down still runs: typing asks nobody.
    services(photonUp, nominatimUp);
    vi.setSystemTime(Date.now() + PHOTON_COOL_DOWN_MS - 10_000);
    await user.keyboard(" s");
    await pause(500);
    expect(calls.photon).toEqual([]);
    expect(screen.getByText(NOTE)).toBeInTheDocument();

    // After it, the next keystroke probes — and suggestions are simply back.
    vi.setSystemTime(Date.now() + 11_000);
    await user.keyboard("t");
    expect(
      await screen.findByRole("option", { name: "lombard st live, Liveville" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(NOTE)).not.toBeInTheDocument());
    expect(calls.photon).toEqual(["lombard st"]);
    expect(calls.nominatim).toEqual([]);
    expect(getPhotonHealth()).toBe("up");
    expect(screen.queryByRole("option", { name: /^search for/i })).not.toBeInTheDocument();

    // Live again: more typing brings more suggestions without Enter.
    await user.keyboard("reet");
    expect(
      await screen.findByRole("option", { name: "lombard street live, Liveville" }),
    ).toBeInTheDocument();
  });

  it("the desktop drop-down behaves the same", async () => {
    services(failing, nominatimUp);
    const { user, onSelect } = setup({ variant: "panel" });
    await open(user, "panel");
    await user.keyboard("2550 pacific avenue");
    await note();
    expect(calls.nominatim).toEqual([]);
    await user.keyboard("{Enter}");
    await screen.findByRole("option", { name: /^2550 Pacific Avenue/ });
    expect(calls.nominatim).toEqual(["2550 pacific avenue"]);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ source: "search" });
  });
});
