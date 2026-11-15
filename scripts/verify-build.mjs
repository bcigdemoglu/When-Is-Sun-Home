// Fails the build when the compiled stylesheets do not match the source.
//
// Why this exists: a production deployment once shipped new JavaScript with a
// stale stylesheet from a restored build cache. Nothing failed, and the phone
// layout was unusable. This check makes that kind of build fail loudly.
//
// How: every custom class selector written in src/app/globals.css must appear
// in the built CSS.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = readFileSync(path.join(root, "src/app/globals.css"), "utf8");

/** Class selectors that start a rule in our own stylesheet, e.g. `.sheet-scroller {`. */
const wanted = new Set();
for (const match of source.matchAll(/^\s*\.([a-zA-Z][\w-]*)[^{;]*\{/gm)) wanted.add(match[1]);
if (wanted.size < 5) {
  console.error("verify-build: found too few class rules in globals.css to check against.");
  process.exit(1);
}

function cssFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...cssFiles(full));
    else if (name.endsWith(".css")) found.push(full);
  }
  return found;
}

const staticDir = path.join(root, ".next/static");
const built = cssFiles(staticDir)
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const missing = [...wanted].filter((name) => !built.includes(`.${name}`));
if (missing.length > 0) {
  console.error(
    `verify-build: the built CSS is missing ${missing.length} of ${wanted.size} class rules from ` +
      `src/app/globals.css (e.g. ${missing
        .slice(0, 6)
        .map((n) => "." + n)
        .join(", ")}).\n` +
      "The stylesheet does not match the source — most likely a stale build cache. Refusing to ship it.",
  );
  process.exit(1);
}
console.log(`verify-build: built CSS contains all ${wanted.size} class rules from globals.css.`);
