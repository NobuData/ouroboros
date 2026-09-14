#!/usr/bin/env node
/**
 * What one App Router route ships to the browser, measured from a finished `next build`.
 *
 * Written for S.2 ([#148](https://github.com/NobuData/ouroboros/issues/148)), whose decision
 * **P2** — the React Flow canvas as a documented exception to the no-framework rule — is only
 * honest with its cost attached. Next 16 prints no size table, so the number has to be read out
 * of the build's own manifest: `.next/server/app/<route>_client-reference-manifest.js` names,
 * per entry (the root layout, the group layout, the page), every client chunk the route loads.
 *
 * Two figures are printed, because they answer two questions:
 *
 * - **route total** — every chunk the route loads, layouts included: what a first visit costs.
 * - **page entry** — the chunks only the page's own entry names: what *this page* adds over the
 *   shell every route already pays for. A dependency mounted by one page shows up here.
 *
 * Both are given raw and gzipped, gzip being what travels. Run it before and after a change on
 * the same route and the delta is the record.
 *
 *   yarn build && node scripts/route-weight.mjs '/(app)/workflows/[slug]/page'
 *
 * Exit status: 0 on a measurement, 1 when the route has no manifest (the build is missing, or
 * the route is spelled differently from `.next/server/app/`'s tree), 2 on a bad invocation.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** The module directory, whatever the working directory was. */
const UI = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where `next build` leaves its output. */
const NEXT = join(UI, ".next");

/**
 * Read the client-reference manifest of one route.
 *
 * The file is a script that assigns into `globalThis.__RSC_MANIFEST`, not JSON; the object is
 * cut out of it rather than evaluated, so measuring a build never runs anything the build wrote.
 *
 * @param {string} route The route key, as `.next/server/app/` spells it — `/(app)/workflows/[slug]/page`.
 * @returns {{ entryJSFiles: Record<string, string[]>, entryCSSFiles: Record<string, string[]> } | null}
 *   The two entry tables, or `null` when the route has no manifest.
 */
function readManifest(route) {
  const file = join(NEXT, "server", "app", `${route}_client-reference-manifest.js`);
  if (!existsSync(file)) return null;

  const source = readFileSync(file, "utf8");
  const start = source.indexOf("= {");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < 0) return null;

  return JSON.parse(source.slice(start + 2, end + 1));
}

/**
 * The path of one manifest entry.
 *
 * A JS entry is a string; a CSS entry is `{ path, inlined }`, because Next may inline a small
 * sheet into the document rather than ship it as a file. Both are read as the path.
 *
 * @param {string | { path: string }} entry One entry of `entryJSFiles` or `entryCSSFiles`.
 * @returns {string} Its path, relative to `.next/`.
 */
function pathOf(entry) {
  return typeof entry === "string" ? entry : entry.path;
}

/**
 * The size of one emitted file, raw and gzipped.
 *
 * @param {string} file A path relative to `.next/`, as the manifest spells it.
 * @returns {{ file: string, raw: number, gzip: number }} The measurement.
 */
function measure(file) {
  const path = join(NEXT, file);
  const raw = statSync(path).size;
  const gzip = gzipSync(readFileSync(path), { level: 9 }).length;

  return { file, raw, gzip };
}

/**
 * Sum a set of measurements.
 *
 * @param {ReadonlyArray<{ raw: number, gzip: number }>} sizes What to add up.
 * @returns {{ raw: number, gzip: number }} The totals.
 */
function total(sizes) {
  return sizes.reduce((sum, size) => ({ raw: sum.raw + size.raw, gzip: sum.gzip + size.gzip }), {
    raw: 0,
    gzip: 0,
  });
}

/**
 * Kilobytes, one decimal, right-aligned in a column.
 *
 * @param {number} bytes A size.
 * @returns {string} `123.4 kB`.
 */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1).padStart(7)} kB`;
}

/**
 * Print one section of the report.
 *
 * @param {string} title What the section measures.
 * @param {ReadonlyArray<{ file: string, raw: number, gzip: number }>} sizes Its files.
 * @returns {void}
 */
function report(title, sizes) {
  const sum = total(sizes);

  console.log(`${title} — ${sizes.length} file(s), ${kb(sum.raw).trim()} raw, ${kb(sum.gzip).trim()} gzip`);
  for (const size of [...sizes].sort((a, b) => b.gzip - a.gzip)) {
    console.log(`  ${kb(size.raw)}  ${kb(size.gzip)} gzip  ${size.file}`);
  }
  console.log();
}

const route = process.argv[2];

if (route === undefined) {
  console.error("usage: node scripts/route-weight.mjs '<route>'   e.g. '/(app)/workflows/[slug]/page'");
  process.exit(2);
}

const manifest = readManifest(route);

if (manifest === null) {
  console.error(`route-weight: no manifest for ${route} — run \`yarn build\` first, and spell the route as .next/server/app/ does`);
  process.exit(1);
}

/** The page's own entry: the one manifest key that ends in this route. */
const pageEntry = Object.keys(manifest.entryJSFiles).find((entry) => entry.endsWith(route));

/** Every (entry, file) pair the route loads, JS and CSS alike. */
const loads = [
  ...Object.entries(manifest.entryJSFiles),
  ...Object.entries(manifest.entryCSSFiles),
].flatMap(([entry, files]) => files.map((file) => [entry, pathOf(file)]));

/** Every file any entry of the route loads, once. */
const routeFiles = new Set(loads.map(([, file]) => file));

/** Every file the other entries load — the shell the page sits in. */
const shellFiles = new Set(loads.filter(([entry]) => entry !== pageEntry).map(([, file]) => file));

const pageOnly = [...routeFiles].filter((file) => !shellFiles.has(file));

console.log(`route ${route}\n`);
report("route total (layouts + page)", [...routeFiles].map(measure));
report("page entry (what this page adds over the shell)", pageOnly.map(measure));
