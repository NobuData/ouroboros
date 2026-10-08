#!/usr/bin/env node
// @ts-check
/**
 * Copies the brand into the docs site, or checks that the copies still match (CY.3, #1166).
 *
 * The design tokens, the logo PNGs and the favicon set each have one home elsewhere in the
 * repository; the site keeps byte-identical copies so it builds from its own directory
 * (and, later, inside its own image). Nobody edits a copy: edit the source and run
 * `yarn sync:brand`. `yarn build` and `yarn dev` sync first, and `yarn check:brand` (also
 * run by `yarn test`) fails when a copy has drifted from its source.
 *
 * Usage:
 *   node scripts/sync-brand.mjs            copy every source over its copy
 *   node scripts/sync-brand.mjs --check    exit 1 listing each copy that differs
 *
 * Exit codes: 0 in sync (or synced), 1 drift found by --check, 2 usage error or a missing
 * source under --check.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The module directory (`ouroboros-docs/`). */
export const MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The repository root, which holds every source. */
export const REPO_ROOT = resolve(MODULE_DIR, "..");

/**
 * Every copy the site keeps: `from` is relative to the repository root, `to` to the module.
 *
 * - The design tokens (`docs/design/tokens.css`) — the only place colour literals live.
 * - The brand PNGs (`docs/brand/`, `docs/BRAND.md`) and the mockups' older logo crops.
 * - The favicon set `scripts/build-favicons.py` derives from the icon pair into
 *   `ouroboros-ui/public/` — reused rather than generated a second time.
 *
 * @type {ReadonlyArray<{ from: string; to: string }>}
 */
export const BRAND_COPIES = [
  { from: "docs/design/tokens.css", to: "src/css/tokens.css" },
  ...[
    "glyph-light.png",
    "glyph-dark.png",
    "icon-light.png",
    "icon-dark.png",
    "lockup-tagline-light.png",
    "lockup-tagline-dark.png",
  ].map((name) => ({ from: `docs/brand/${name}`, to: `static/img/brand/${name}` })),
  ...["logo-lockup.png", "logo-mark.png"].map((name) => ({
    from: `docs/mockups/assets/${name}`,
    to: `static/img/brand/${name}`,
  })),
  ...["favicon.ico", "favicon-32-light.png", "favicon-32-dark.png", "apple-touch-icon.png"].map(
    (name) => ({ from: `ouroboros-ui/public/${name}`, to: `static/img/brand/favicon/${name}` }),
  ),
];

/**
 * Compares every copy with its source.
 *
 * @param {string} repoRoot the repository root to read sources from.
 * @param {string} moduleDir the docs module whose copies are checked.
 * @returns {{ missingSources: string[]; drifted: string[] }} sources that do not exist,
 *   and copies (module-relative) that are absent or differ byte-for-byte from their source.
 */
export function findDrift(repoRoot = REPO_ROOT, moduleDir = MODULE_DIR) {
  const missingSources = [];
  const drifted = [];
  for (const { from, to } of BRAND_COPIES) {
    const source = join(repoRoot, from);
    const copy = join(moduleDir, to);
    if (!existsSync(source)) {
      missingSources.push(from);
    } else if (!existsSync(copy) || !readFileSync(source).equals(readFileSync(copy))) {
      drifted.push(to);
    }
  }
  return { missingSources, drifted };
}

/**
 * Copies every source over its copy, creating folders as needed.
 *
 * @param {string} repoRoot the repository root to read sources from.
 * @param {string} moduleDir the docs module to write copies into.
 * @returns {number} how many files were copied.
 * @throws {Error} when a source is missing — a half-synced brand is worse than none.
 */
export function syncBrand(repoRoot = REPO_ROOT, moduleDir = MODULE_DIR) {
  const { missingSources } = findDrift(repoRoot, moduleDir);
  if (missingSources.length > 0) {
    throw new Error(`brand sources missing: ${missingSources.join(", ")}`);
  }
  for (const { from, to } of BRAND_COPIES) {
    const copy = join(moduleDir, to);
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(join(repoRoot, from), copy);
  }
  return BRAND_COPIES.length;
}

/**
 * The command-line entry point.
 *
 * Outside the repository — the module copied on its own, as an image build does — the
 * sources are absent; a plain sync then keeps the committed copies and says so, while
 * `--check` refuses, because it cannot prove anything.
 *
 * @param {string[]} args the arguments after the script name.
 * @returns {number} the process exit code.
 */
function main(args) {
  const check = args.includes("--check");
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(`sync-brand: unknown argument: ${unknown[0]}`);
    return 2;
  }
  const standalone = !existsSync(join(REPO_ROOT, BRAND_COPIES[0].from));
  if (check) {
    const { missingSources, drifted } = findDrift();
    if (missingSources.length > 0) {
      console.error(`sync-brand: sources missing: ${missingSources.join(", ")}`);
      return 2;
    }
    if (drifted.length > 0) {
      console.error(
        `sync-brand: these copies differ from their source — run yarn sync:brand:\n  ${drifted.join("\n  ")}`,
      );
      return 1;
    }
    console.log(`sync-brand: ${BRAND_COPIES.length} copies match their sources`);
    return 0;
  }
  if (standalone) {
    console.log("sync-brand: outside the repository — keeping the committed copies");
    return 0;
  }
  console.log(`sync-brand: copied ${syncBrand()} files`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
