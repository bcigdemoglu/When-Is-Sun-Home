/**
 * A minimal PNG decoder for elevation tiles.
 *
 * Terrarium tiles pack a number into the red, green and blue channels, so the
 * pixels must be read BIT-EXACT. Going through a canvas is fragile for that:
 * browsers may colour-manage the image, and privacy features (Brave's
 * "farbling", Firefox's resistFingerprinting) deliberately add noise to pixels
 * read back from a canvas — one flipped bit in the red channel is a 256 m
 * spike. So the tile bytes are decoded directly instead: parse the chunks,
 * inflate the image data with the platform's `DecompressionStream`, undo the
 * scanline filters. No canvas, works in workers and in Node.
 *
 * Supports exactly what the tiles use (and a little more): 8-bit truecolour,
 * with or without alpha, non-interlaced. Anything else throws
 * {@link UnsupportedPngError} so the caller can fall back to another decoder.
 */
import type { DecodedTile } from "./terrarium";

export class UnsupportedPngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPngError";
  }
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunk types as big-endian integers. */
const IHDR = 0x49484452;
const IDAT = 0x49444154;
const IEND = 0x49454e44;
/** Largest image this decoder will allocate for (tiles are 256 or 512 px). */
const MAX_DIMENSION = 4096;

/** Can this runtime inflate PNG image data? (All current browsers and Node ≥ 18.) */
export function canDecodePng(): boolean {
  return typeof DecompressionStream === "function" && typeof Response === "function";
}

async function inflate(zlibData: Uint8Array): Promise<Uint8Array> {
  // PNG image data is a zlib stream, which DecompressionStream calls "deflate".
  const stream = new Blob([zlibData as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Decode an 8-bit RGB or RGBA, non-interlaced PNG into RGBA pixels (alpha 255
 * for RGB images). Throws {@link UnsupportedPngError} for other PNG flavours
 * and a plain Error for data that is not a valid PNG at all.
 */
export async function decodePng(bytes: Uint8Array): Promise<DecodedTile> {
  if (bytes.length < 8 || SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error("Not a PNG file");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let channels = 0;
  const imageData: Uint8Array[] = [];
  let imageDataLength = 0;
  let ended = false;

  for (let offset = 8; offset + 12 <= bytes.length && !ended;) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    const start = offset + 8;
    if (start + length + 4 > bytes.length) throw new Error("Truncated PNG chunk");

    if (type === IHDR) {
      if (length < 13) throw new Error("Invalid PNG header");
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      const bitDepth = bytes[start + 8];
      const colourType = bytes[start + 9];
      const interlace = bytes[start + 12];
      if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
        throw new UnsupportedPngError(
          `Unsupported PNG flavour (bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace})`,
        );
      }
      if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new UnsupportedPngError(`Unsupported PNG size ${width}×${height}`);
      }
      channels = colourType === 2 ? 3 : 4;
    } else if (type === IDAT) {
      imageData.push(bytes.subarray(start, start + length));
      imageDataLength += length;
    } else if (type === IEND) {
      ended = true;
    }
    offset = start + length + 4; // skip the CRC
  }
  if (channels === 0) throw new Error("PNG has no header");
  if (imageDataLength === 0) throw new Error("PNG has no image data");

  const compressed = new Uint8Array(imageDataLength);
  let position = 0;
  for (const chunk of imageData) {
    compressed.set(chunk, position);
    position += chunk.length;
  }
  const raw = await inflate(compressed);

  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) {
    throw new Error(`PNG image data has ${raw.length} bytes, expected ${(stride + 1) * height}`);
  }

  // Undo the per-scanline prediction filters, in place, then expand to RGBA.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const above = line - (stride + 1); // only read when y > 0
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? raw[line + i - channels] : 0;
      const up = y > 0 ? raw[above + i] : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = (left + up) >> 1;
          break;
        case 4: {
          // Paeth: whichever of left / up / upper-left is closest to left + up − upper-left.
          const upLeft = y > 0 && i >= channels ? raw[above + i - channels] : 0;
          const estimate = left + up - upLeft;
          const dLeft = Math.abs(estimate - left);
          const dUp = Math.abs(estimate - up);
          const dUpLeft = Math.abs(estimate - upLeft);
          predicted = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
          break;
        }
        default:
          throw new Error(`Invalid PNG filter type ${filter}`);
      }
      raw[line + i] = (raw[line + i] + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const source = line + x * channels;
      const target = 4 * (y * width + x);
      data[target] = raw[source];
      data[target + 1] = raw[source + 1];
      data[target + 2] = raw[source + 2];
      data[target + 3] = channels === 4 ? raw[source + 3] : 255;
    }
  }

  return { width, height, data };
}
