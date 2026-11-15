// Works out where a regional aerial-photo tile service has photos all over,
// for the coverage table of its entry in src/components/map/imagery.ts.
//
//   node scripts/imagery-coverage.mjs "<tile URL with {z}/{y}/{x}>" <west,south,east,north> [zoom]
//
//   node scripts/imagery-coverage.mjs \
//     "https://www.portlandmaps.com/arcgis/rest/services/Public/Aerial_Photos_Summer_2025/MapServer/tile/{z}/{y}/{x}" \
//     -123.19,45.26,-122.32,45.67 14
//
// How: such services ("Mixed" tile format) answer a JPEG where a tile is all
// photo, a PNG where part of it is transparent (the edge of the coverage) and
// 404 where there is nothing. Every tile of one coarse zoom level inside the
// box is asked for once, a few at a time (the servers refuse bursts), and the
// JPEG ones are printed as the `rows` of a coverage table: for each tile row,
// the runs of fully covered columns. A picture of the coverage goes to stderr.
//
// Then `--check` asks for a sample of deep tiles inside the covered ones, to
// confirm that "all photo at the coarse level" means "there are photos at the
// levels people look at":
//
//   node scripts/imagery-coverage.mjs "<url>" <box> 14 --check 19,21

const [template, box, zoomArg = "14", ...rest] = process.argv.slice(2);
if (!template || !box || !template.includes("{z}")) {
  console.error(
    'usage: node scripts/imagery-coverage.mjs "<tile URL>" <west,south,east,north> [zoom] [--check z,z]',
  );
  process.exit(2);
}
const zoom = Number(zoomArg);
const [west, south, east, north] = box.split(",").map(Number);
const checkAt = rest[0] === "--check" ? (rest[1] ?? "19,21").split(",").map(Number) : null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tileX = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const phi = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * 2 ** z);
};
const urlOf = (z, x, y) => template.replace("{z}", z).replace("{x}", x).replace("{y}", y);

/** "J" all photo, "P" partly transparent, "." nothing; "?" when the server would not say. */
async function kindOf(z, x, y) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(urlOf(z, x, y));
      await response.arrayBuffer();
      if (response.status === 404) return ".";
      const type = response.headers.get("content-type") ?? "";
      if (response.status === 200) return /jpe?g/.test(type) ? "J" : "P";
    } catch {
      // Busy or unreachable: wait and ask again.
    }
    await sleep(400 * (attempt + 1));
  }
  return "?";
}

const x0 = tileX(west, zoom);
const x1 = tileX(east, zoom);
const y0 = tileY(north, zoom);
const y1 = tileY(south, zoom);
const rows = {};
const counts = { J: 0, P: 0, ".": 0, "?": 0 };
for (let y = y0; y <= y1; y++) {
  let picture = "";
  for (let x = x0; x <= x1; x += 2) {
    const pair = await Promise.all(
      [x, x + 1].filter((column) => column <= x1).map((column) => kindOf(zoom, column, y)),
    );
    picture += pair.join("");
    await sleep(60);
  }
  console.error(String(y).padStart(7), picture);
  const runs = [];
  [...picture].forEach((kind, i) => {
    counts[kind]++;
    if (kind !== "J") return;
    const last = runs[runs.length - 1];
    if (last && last[1] === x0 + i - 1) last[1] = x0 + i;
    else runs.push([x0 + i, x0 + i]);
  });
  if (runs.length > 0) rows[y] = runs;
}
console.error(
  `zoom ${zoom}: ${counts.J} all photo, ${counts.P} partly, ${counts["."]} nothing, ${counts["?"]} unknown`,
);
if (counts["?"] > 0) {
  console.error("Some tiles could not be read: run again before using the result.");
  process.exitCode = 1;
}

console.log(`  zoom: ${zoom},`);
console.log("  rows: {");
for (const [y, runs] of Object.entries(rows)) console.log(`    ${y}: ${JSON.stringify(runs)},`);
console.log("  },");

if (checkAt) {
  // One spot in each covered tile (a different corner region each time), at every level asked for.
  let asked = 0;
  const failures = [];
  let n = 0;
  for (const [y, runs] of Object.entries(rows)) {
    for (const [from, to] of runs) {
      for (let x = from; x <= to; x++) {
        n++;
        const fx = ((n * 37) % 100) / 100;
        const fy = ((n * 61) % 100) / 100;
        for (const z of checkAt) {
          const scale = 2 ** (z - zoom);
          const dx = Math.floor((x + fx) * scale);
          const dy = Math.floor((Number(y) + fy) * scale);
          const kind = await kindOf(z, dx, dy);
          asked++;
          if (kind !== "J") failures.push(`${z}/${dx}/${dy} (in ${zoom}/${x}/${y}): ${kind}`);
          await sleep(40);
        }
      }
    }
  }
  console.error(
    `check: ${asked} deep tiles asked for inside covered tiles, ${failures.length} not a full photo`,
  );
  for (const failure of failures.slice(0, 40)) console.error("  " + failure);
  if (failures.length > 0) process.exitCode = 1;
}
