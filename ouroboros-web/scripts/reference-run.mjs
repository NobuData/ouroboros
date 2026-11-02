#!/usr/bin/env node
//
// reference-run.mjs — the hero's figures, read from the reference run's evidence (DL.4, #1328).
//
// The marketing page states what one real run measured and nothing else. Its figures come from
// `data/reference-run.json`, which this script generates from the newest bundle under the repo's
// `docs/reference-run/<date>/` (written by `scripts/reference-bundle.sh`, DL.3 #1327), so the page
// cannot drift from the evidence:
//
//   node scripts/reference-run.mjs --write   regenerate data/reference-run.json from the bundle
//   node scripts/reference-run.mjs --check   fail if the file is malformed, names a bundle that is
//                                            missing, or differs from what the bundle gives
//
// `yarn build` runs --check first. With the repo checked out (CI's build job, a laptop) it compares
// against the bundle; inside the Docker build, whose context is `ouroboros-web/` alone, the bundle
// is out of reach and only the file's own shape is checked — the CI build job has already compared
// it.
//
// No bundle yet → the file holds `{"bundle": null}` and the page shows no figure at all. The file
// never carries a rate, a percentage or a per-merge cost: one run has none (decision L13).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The web module's root — `ouroboros-web/`. */
export const WEB_ROOT = path.dirname(HERE);
/** The repository's root, one level up; holds `docs/` only in a full checkout. */
export const REPO_ROOT = path.dirname(WEB_ROOT);
/** The generated file the page imports. */
export const DATA_FILE = path.join(WEB_ROOT, "data", "reference-run.json");
/** Bundles live here, relative to the repository root. */
export const BUNDLES = "docs/reference-run";
/** Where a bundle file is linked to, so a figure opens its evidence. */
export const EVIDENCE_BASE = "https://github.com/NobuData/ouroboros/blob/main/";

/**
 * The figures the hero shows, in order, and how each is labelled. Each comes from the bundle
 * manifest's `figures` by id; a figure the bundle did not measure (value `null`) is left out.
 */
const HERO_FIGURES = [
  { id: "wallClock", label: () => "issue → draft pull request", format: (v) => clock(v) },
  { id: "modelCalls", label: (v) => (v === 1 ? "model call" : "model calls"), format: (v) => String(v) },
  { id: "costCents", label: () => "on our own API key", format: (v) => `$${(v / 100).toFixed(2)}` },
  { id: "correctionRounds", label: (v) => (v === 1 ? "correction round" : "correction rounds"), format: (v) => String(v) },
];

/** What a figure's display or label may never say: a rate, a percentage, a per-merge cost. */
const FORBIDDEN = [/%/, /per merged/i, /\brate\b/i];

/**
 * Formats whole seconds as a clock reading.
 *
 * @param {number} s - Whole seconds.
 * @returns {string} `6:12`, or `1:02:03` from an hour up.
 */
export function clock(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/**
 * The SHA-256 of a file, in hex.
 *
 * @param {string} file - Absolute path.
 * @returns {string} The digest.
 */
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * The bundles in a checkout, oldest first.
 *
 * @param {string} repoRoot - The repository root.
 * @returns {string[] | null} Bundle directory names (`2026-10-24`), or `null` when the checkout has
 *   no `docs/reference-run/` at all — the Docker build, where the bundle is out of reach.
 */
export function bundles(repoRoot) {
  const dir = path.join(repoRoot, BUNDLES);
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(dir, d, "manifest.json")))
    .sort();
}

/**
 * Composes the hero's data from one bundle.
 *
 * @param {string} repoRoot - The repository root.
 * @param {string | null} bundle - The bundle's directory name, or `null` for "no run yet".
 * @returns {object} The content of `data/reference-run.json`.
 * @throws {Error} When the bundle's manifest does not vouch for its own run manifest.
 */
export function compose(repoRoot, bundle) {
  if (bundle === null) {
    return {
      bundle: null,
      note: "No reference run has been published yet; the page shows no figure until one is.",
    };
  }
  const base = `${BUNDLES}/${bundle}`;
  const manifestPath = path.join(repoRoot, base, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const runEntry = (manifest.files || []).find((f) => f.path === "run/manifest.json");
  const runPath = path.join(repoRoot, base, "run", "manifest.json");
  if (!runEntry || runEntry.sha256 !== sha256(runPath)) {
    throw new Error(`${base}/run/manifest.json does not match the checksum its bundle manifest records`);
  }
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  const byId = new Map((manifest.figures || []).map((f) => [f.id, f]));
  const figures = HERO_FIGURES.flatMap(({ id, label, format }) => {
    const f = byId.get(id);
    if (!f || f.value === null || f.value === undefined) return [];
    return [{ id, value: f.value, display: format(f.value), label: label(f.value), href: `${EVIDENCE_BASE}${base}/${f.source}` }];
  });
  return {
    bundle,
    source: `${base}/manifest.json`,
    manifestSha256: sha256(manifestPath),
    sample: 1,
    repository: manifest.repository,
    issue: manifest.issue,
    models: [...new Set(Object.values(run.aliases || {}))],
    pullRequest: manifest.pullRequest,
    recording: manifest.recording ? manifest.recording.url : null,
    evidence: `${EVIDENCE_BASE}${base}/SUMMARY.md`,
    figures,
  };
}

/**
 * Checks the data file's own shape — what holds wherever the build runs.
 *
 * @param {object} data - The parsed data file.
 * @returns {string[]} Problems; empty when it is well formed.
 */
export function shapeProblems(data) {
  const problems = [];
  if (data === null || typeof data !== "object") return ["the file is not a JSON object"];
  if (data.bundle === null) {
    if (data.figures !== undefined) problems.push("a file with no bundle carries figures");
    return problems;
  }
  if (typeof data.bundle !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.bundle)) {
    return [`"bundle" must be null or a bundle date, not ${JSON.stringify(data.bundle)}`];
  }
  if (data.sample !== 1) problems.push('"sample" must state the one run (1)');
  if (!Array.isArray(data.figures) || data.figures.length === 0) problems.push("a bundle with no figures");
  for (const f of data.figures || []) {
    if (typeof f.display !== "string" || typeof f.label !== "string") problems.push(`figure ${f.id} lacks a display or a label`);
    if (typeof f.href !== "string" || !f.href.startsWith(`${EVIDENCE_BASE}${BUNDLES}/${data.bundle}/`)) {
      problems.push(`figure ${f.id} does not link a file in its bundle`);
    }
    for (const bad of FORBIDDEN) {
      if (bad.test(`${f.display} ${f.label}`)) problems.push(`figure ${f.id} states a rate or percentage: ${f.display} ${f.label}`);
    }
  }
  return problems;
}

/**
 * The full check: the shape, then — where the checkout has bundles — that the file names the newest
 * bundle, that the bundle is there, and that the file is exactly what that bundle gives.
 *
 * @param {object} data - The parsed data file.
 * @param {string} repoRoot - The repository root.
 * @returns {{problems: string[], compared: boolean}} Problems, and whether the bundle was in reach.
 */
export function check(data, repoRoot) {
  const problems = shapeProblems(data);
  if (problems.length) return { problems, compared: false };
  const found = bundles(repoRoot);
  if (found === null) return { problems, compared: false };
  if (data.bundle !== null && !found.includes(data.bundle)) {
    return { problems: [`its source bundle ${BUNDLES}/${data.bundle}/ is missing`], compared: true };
  }
  const newest = found.length ? found[found.length - 1] : null;
  if (data.bundle !== newest) {
    return { problems: [`it shows ${data.bundle ?? "no bundle"} but the newest bundle is ${newest} — run yarn gen:reference`], compared: true };
  }
  let expected;
  try {
    expected = compose(repoRoot, newest);
  } catch (e) {
    return { problems: [e.message], compared: true };
  }
  if (JSON.stringify(expected) !== JSON.stringify(data)) {
    problems.push(`it differs from what ${BUNDLES}/${newest}/ gives — run yarn gen:reference`);
  }
  return { problems, compared: true };
}

/** Command line: --write or --check. */
function main(argv) {
  const mode = argv[0];
  if (mode === "--write") {
    const found = bundles(REPO_ROOT);
    if (found === null) {
      process.stderr.write(`reference-run: no ${BUNDLES}/ here — run it from a full checkout\n`);
      return 2;
    }
    const data = compose(REPO_ROOT, found.length ? found[found.length - 1] : null);
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n");
    process.stdout.write(`reference-run: wrote data/reference-run.json from ${data.bundle ?? "no bundle"}\n`);
    return 0;
  }
  if (mode === "--check") {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch {
      process.stderr.write("reference-run: data/reference-run.json is missing or not JSON\n");
      return 1;
    }
    const { problems, compared } = check(data, REPO_ROOT);
    for (const p of problems) process.stderr.write(`reference-run: data/reference-run.json: ${p}\n`);
    if (problems.length) return 1;
    process.stdout.write(
      compared
        ? `reference-run: data/reference-run.json matches ${data.bundle ?? "the absence of a bundle"}\n`
        : `reference-run: data/reference-run.json is well formed (no ${BUNDLES}/ in reach to compare)\n`,
    );
    return 0;
  }
  process.stderr.write("usage: reference-run.mjs --write | --check\n");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
