import { encode } from "uqr";

interface QrCodeProps {
  /** What the code says (a URL). */
  value: string;
  /** Rendered width and height, px. */
  size?: number;
  className?: string;
}

/** One SVG path for all dark modules: each run of dark cells in a row is one rectangle. */
function modulesPath(data: boolean[][]): string {
  let path = "";
  for (let row = 0; row < data.length; row++) {
    const cells = data[row];
    let col = 0;
    while (col < cells.length) {
      if (!cells[col]) {
        col++;
        continue;
      }
      const start = col;
      while (col < cells.length && cells[col]) col++;
      path += `M${start} ${row}h${col - start}v1h-${col - start}z`;
    }
  }
  return path;
}

/**
 * A QR code as inline SVG. Always dark modules on a white tile, whatever the
 * theme: phone cameras need the contrast and the light quiet zone (here the
 * tile's padding, about four modules wide). The lowest error-correction level
 * is used on purpose — nothing damages a code on a screen, and fewer, larger
 * modules scan more easily.
 */
export function QrCode({ value, size = 136, className = "" }: QrCodeProps) {
  let modules: boolean[][] | null = null;
  try {
    modules = encode(value, { ecc: "L", border: 0 }).data;
  } catch {
    // Longer than a QR code can hold (never the case for a share link).
  }
  if (!modules || modules.length === 0) return null;
  const count = modules.length;
  const quiet = 4;
  const box = count + quiet * 2;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code with the link to this report"
      data-modules={count}
    >
      {/* Literal colours, not theme tokens: a QR code must stay dark on white in dark mode too. */}
      <rect x={-quiet} y={-quiet} width={box} height={box} rx="3" fill="#ffffff" />
      <path d={modulesPath(modules)} fill="#1e1a15" />
    </svg>
  );
}
