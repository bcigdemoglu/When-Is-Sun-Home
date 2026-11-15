/**
 * TEST HELPERS ONLY — never import this from application code.
 */
import fc from "fast-check";

/**
 * A real number in [min, max], mostly UNIFORMLY distributed.
 *
 * `fc.double` is uniform over float bit patterns, so almost everything it
 * produces is within a hair of zero — "random" buildings would all sit on the
 * observer or on an axis. This draws uniformly instead, and mixes in some
 * `fc.double` values to keep its edge cases (0, the bounds, tiny numbers).
 */
export function real(min: number, max: number): fc.Arbitrary<number> {
  const steps = 2 ** 31 - 1;
  const uniform = fc
    .integer({ min: 0, max: steps })
    .map((i) => Math.min(max, min + ((max - min) * i) / steps));
  return fc.oneof(
    { weight: 5, arbitrary: uniform },
    { weight: 1, arbitrary: fc.double({ min, max, noNaN: true }) },
  );
}
