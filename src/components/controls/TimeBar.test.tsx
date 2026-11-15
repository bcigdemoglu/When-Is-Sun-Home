// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SunState } from "@/lib/types";
import { useSettings } from "@/state";
import { TimeBar, sunStateLabel, type TimeBarProps } from "./TimeBar";

const KEY_DATES = {
  longest: "2026-06-21",
  shortest: "2026-12-21",
  marchEquinox: "2026-03-20",
  septemberEquinox: "2026-09-22",
};

const BASE: TimeBarProps = {
  variant: "docked",
  zoneLabel: "Los Angeles time (PDT, UTC−7)",
  zone: "PDT",
  date: "2026-10-05",
  minuteOfDay: 15 * 60 + 40,
  isLive: false,
  today: "2026-11-14",
  nowMinute: 600,
  track: undefined,
  sunriseMinute: 433,
  sunsetMinute: 1122,
  sunState: SunState.Sun,
  keyDates: KEY_DATES,
};

beforeEach(() => {
  useSettings.getState().reset();
  useSettings.getState().setDateTime("2026-10-05", 15 * 60 + 40);
});

afterEach(() => {
  cleanup();
});

function setup(props: Partial<TimeBarProps> = {}) {
  const user = userEvent.setup();
  render(<TimeBar {...BASE} {...props} />);
  return { user };
}

const settings = () => useSettings.getState();

describe("sunStateLabel", () => {
  it("puts every state in words", () => {
    expect(sunStateLabel(SunState.Sun).text).toBe("In sun");
    expect(sunStateLabel(SunState.Blocked).text).toBe("In shade");
    expect(sunStateLabel(SunState.OutOfView).text).toBe("Sun out of view");
    expect(sunStateLabel(SunState.Night).text).toBe("Night");
    expect(sunStateLabel(null).text).toBe("");
  });
});

describe("TimeBar", () => {
  it("is a real range input that says the time and what the sun is doing", () => {
    setup();
    const slider = screen.getByRole("slider", { name: "Time of day" });
    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "1439");
    expect(slider).toHaveValue("940");
    expect(slider).toHaveAttribute("aria-valuetext", "3:40 PM PDT, in sun");
  });

  it("writes the time to the store as the slider moves", () => {
    setup();
    fireEvent.change(screen.getByRole("slider", { name: "Time of day" }), {
      target: { value: "600" },
    });
    expect(settings().minuteOfDay).toBe(600);
  });

  it("shows the day as a date, or as Today", () => {
    setup();
    expect(screen.getByRole("button", { name: /Mon, Oct 5, 3:40 PM PDT/ })).toBeInTheDocument();
    cleanup();
    setup({ date: "2026-11-14" });
    expect(screen.getByRole("button", { name: /^Today, 3:40 PM PDT/ })).toBeInTheDocument();
    cleanup();
    setup({ date: "2027-01-02" });
    expect(screen.getByRole("button", { name: /Sat, Jan 2, 2027/ })).toBeInTheDocument();
  });

  it("shows a large readout while the thumb is held, and after a key press", async () => {
    setup();
    const slider = screen.getByRole("slider", { name: "Time of day" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.pointerDown(slider);
    const readout = screen.getByRole("status");
    expect(readout).toHaveTextContent("3:40 PM");
    expect(readout).toHaveTextContent("In sun");
    fireEvent.pointerUp(slider);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("offers the way back to now only when it is not live", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Back to now" }));
    expect(settings().date).toBeNull();
    expect(settings().minuteOfDay).toBeNull();
    cleanup();
    setup({ isLive: true });
    expect(screen.queryByRole("button", { name: "Back to now" })).not.toBeInTheDocument();
  });

  it("hides the way back while the thumb is held, so the slider does not jump under the finger", () => {
    setup();
    fireEvent.pointerDown(screen.getByRole("slider", { name: "Time of day" }));
    expect(screen.queryByRole("button", { name: "Back to now" })).not.toBeInTheDocument();
  });

  it("opens a day menu with the days worth comparing", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Change the day/ }));
    const menu = screen.getByRole("dialog", { name: "Day" });
    expect(within(menu).getByRole("button", { name: /Today/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /Longest day.*Jun 21/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /Shortest day.*Dec 21/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /March equinox/ })).toBeInTheDocument();
    expect(within(menu).getByRole("button", { name: /September equinox/ })).toBeInTheDocument();
    expect(within(menu).getByLabelText("Pick a date")).toHaveValue("2026-10-05");
    expect(within(menu).getByText(/Times are in Los Angeles time/)).toBeInTheDocument();

    await user.click(within(menu).getByRole("button", { name: /Shortest day/ }));
    expect(settings().date).toBe("2026-12-21");
    expect(screen.queryByRole("button", { name: /Shortest day/ })).not.toBeInTheDocument();
  });

  it("goes to today by clearing the date (it then follows the calendar)", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Change the day/ }));
    await user.click(screen.getByRole("button", { name: /^Today/ }));
    expect(settings().date).toBeNull();
    expect(settings().minuteOfDay).toBe(940);
  });

  it("steps a day at a time from the menu and takes a typed date", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Change the day/ }));
    const menu = screen.getByRole("dialog", { name: "Day" });
    await user.click(within(menu).getByRole("button", { name: "Next day" }));
    expect(settings().date).toBe("2026-10-06");
    await user.click(within(menu).getByRole("button", { name: "Previous day" }));
    await user.click(within(menu).getByRole("button", { name: "Previous day" }));
    expect(settings().date).toBe("2026-10-04");

    const field = within(menu).getByLabelText("Pick a date");
    fireEvent.change(field, { target: { value: "0002-03-01" } });
    expect(settings().date).toBe("2026-10-04"); // half-typed: ignored
    fireEvent.change(field, { target: { value: "2026-03-01" } });
    expect(settings().date).toBe("2026-03-01");
  });

  it("has day steppers on the bar itself in the floating (desktop) variant", async () => {
    const { user } = setup({ variant: "floating" });
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(settings().date).toBe("2026-10-06");
  });

  it("labels the play button by what it will play", async () => {
    const { user } = setup();
    expect(screen.getByRole("button", { name: /Play the day/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Change the day/ }));
    await user.click(screen.getByRole("radio", { name: "Through the year" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Play through the year" })).toBeInTheDocument();
  });
});
