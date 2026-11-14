/**
 * Decoding "Terrarium" elevation tiles.
 *
 * Each pixel encodes metres above sea level in its colour:
 *   elevation = (red · 256 + green + blue / 256) − 32768
 * (https://github.com/tilezen/joerd/blob/master/docs/formats.md#terrarium).
 */

/** A decoded image: `width · height` RGBA pixels, row by row from the top. */
export interface DecodedTile {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Elevations no real place on Earth has; outside this the pixels are not Terrarium data. */
const MIN_PLAUSIBLE_M = -12_000;
const MAX_PLAUSIBLE_M = 9_000;

export function terrariumToMeters(red: number, green: number, blue: number): number {
  return red * 256 + green + blue / 256 - 32_768;
}

/** The colour that encodes an elevation (inverse of {@link terrariumToMeters}; for tests). */
export function metersToTerrarium(elevationM: number): [number, number, number] {
  const value = Math.round((elevationM + 32_768) * 256);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * Elevations (metres) of every pixel of a decoded tile, row by row from the
 * top (north).
 *
 * Throws if the pixels cannot be genuine Terrarium data: wrong buffer size, a
 * non-opaque pixel (browsers premultiply colour by alpha, which would corrupt
 * the encoding) or an absurd elevation (a sign that the image was
 * colour-managed or re-encoded on the way).
 */
export function decodeTerrarium(tile: DecodedTile): Float32Array {
  const { width, height, data } = tile;
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || pixels <= 0) {
    throw new RangeError(`decodeTerrarium: invalid tile size ${width}×${height}`);
  }
  if (data.length !== pixels * 4) {
    throw new RangeError(
      `decodeTerrarium: expected ${pixels * 4} bytes of RGBA, got ${data.length}`,
    );
  }
  const elevations = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const o = 4 * i;
    if (data[o + 3] !== 255) {
      throw new Error(
        "decodeTerrarium: tile has transparent pixels; its colours cannot be trusted",
      );
    }
    const elevation = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32_768;
    if (elevation < MIN_PLAUSIBLE_M || elevation > MAX_PLAUSIBLE_M) {
      throw new Error(`decodeTerrarium: implausible elevation ${elevation} m; not Terrarium data`);
    }
    elevations[i] = elevation;
  }
  return elevations;
}
