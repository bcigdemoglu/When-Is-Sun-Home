import { expect, test } from "vitest";
import { HORIZON_BINS } from "@/lib/types";

test("contracts load", () => {
  expect(HORIZON_BINS).toBe(720);
});
