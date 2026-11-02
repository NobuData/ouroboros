#!/usr/bin/env node
/**
 * The loop-wording guard (DG.4, #1322): fails when a page says "simulated" outside
 * `loop-wording.allow.json`, or when an entry there no longer matches its page. The reading and
 * comparing is `scripts/loop-wording.ts`; this is the command.
 *
 * Usage:
 *   node scripts/check-loop-wording.ts [--docs DIR] [--allow FILE]
 *
 * `yarn check:loop-wording` runs it, and `ci/docs` runs that, so a page that calls the loop
 * simulated again fails the build, naming the page, the line and the fix.
 *
 * Exit codes: 0 every occurrence is allowed, 1 one is not (or an entry is stale), 2 the
 * allow-list could not be read or is malformed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkWording, parseAllowList } from "./loop-wording.ts";

/** The module directory (`ouroboros-docs/`). */
const MODULE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Reads every `.md` and `.mdx` page under a directory.
 *
 * @param dir the pages directory.
 * @param prefix the path so far, relative to `dir`'s root.
 * @returns page path (with `/` separators) → text.
 */
function readPages(dir: string, prefix = ""): Map<string, string> {
  const pages = new Map<string, string>();
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const id = prefix ? `${prefix}/${name}` : name;
    if (statSync(path).isDirectory()) {
      for (const [k, v] of readPages(path, id)) pages.set(k, v);
    } else if (/\.mdx?$/.test(name)) {
      pages.set(id, readFileSync(path, "utf8"));
    }
  }
  return pages;
}

/**
 * Runs the guard.
 *
 * @param argv the arguments after the script's path.
 * @returns the exit code.
 */
function main(argv: string[]): number {
  let docs = join(MODULE_DIR, "docs");
  let allow = join(MODULE_DIR, "loop-wording.allow.json");
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--docs" && argv[i + 1]) docs = resolve(argv[i + 1]);
    else if (argv[i] === "--allow" && argv[i + 1]) allow = resolve(argv[i + 1]);
    else {
      console.error("usage: check-loop-wording.ts [--docs DIR] [--allow FILE]");
      return 2;
    }
  }
  let entries;
  try {
    entries = parseAllowList(readFileSync(allow, "utf8"));
  } catch (e) {
    console.error(`check:loop-wording: ${allow}: ${(e as Error).message}`);
    return 2;
  }
  const pages = readPages(docs);
  const { occurrences, stale } = checkWording(pages, entries);
  for (const o of occurrences) {
    console.error(`check:loop-wording: docs/${o.file}:${String(o.line)} says "simulated": ${o.text}`);
  }
  for (const s of stale) {
    console.error(`check:loop-wording: stale allow-list entry, matches nothing — ${s}`);
  }
  if (occurrences.length > 0) {
    console.error(
      'The loop runs for real: describe what the page means (a live run, a draft-only loop, the run simulator), or — if "simulated" is true there — add the phrase to loop-wording.allow.json with its reason.',
    );
  }
  if (occurrences.length > 0 || stale.length > 0) return 1;
  console.log(`check:loop-wording: ${String(pages.size)} pages, every "simulated" is on the allow-list`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
