// reference-run.test.mjs — tests for scripts/reference-run.mjs and the page it feeds (DL.4, #1328).
//
// Each case builds a throwaway repository root with a `docs/reference-run/<date>/` bundle shaped
// like scripts/reference-bundle.sh's, then checks what the generator composes from it and what the
// build check refuses.
//
// Usage: yarn test   (node --test scripts/)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { BUNDLES, EVIDENCE_BASE, WEB_ROOT, bundles, check, clock, compose, shapeProblems } from "./reference-run.mjs";

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * A repository root holding one bundle per date given.
 *
 * @param {string[]} dates - Bundle dates.
 * @param {object} [figures] - Figure values by id, overriding the defaults.
 * @returns {string} The root.
 */
function repo(dates, figures = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reference-run-"));
  fs.mkdirSync(path.join(root, BUNDLES), { recursive: true });
  for (const date of dates) {
    const dir = path.join(root, BUNDLES, date);
    fs.mkdirSync(path.join(dir, "run"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "run", "manifest.json"),
      JSON.stringify({ aliases: { "slice-planner": "claude-sonnet-4-5", "slice-coder": "claude-sonnet-4-5" } }),
    );
    const values = { wallClock: 372, modelCalls: 4, costCents: 41, correctionRounds: 1, buildSeconds: 122, ...figures };
    const sources = { wallClock: "run/manifest.json", correctionRounds: "run/run.json", buildSeconds: "run/run.json" };
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        bundle: date,
        repository: "NobuData/ouroboros-sample",
        issue: 3,
        pullRequest: "https://github.com/NobuData/ouroboros-sample/pull/12",
        recording: { url: `https://github.com/NobuData/ouroboros/releases/download/reference-run-${date}/recording.mp4` },
        figures: Object.entries(values).map(([id, value]) => ({ id, value, source: sources[id] ?? "run/usage.csv" })),
        files: [{ path: "run/manifest.json", sha256: sha(path.join(dir, "run", "manifest.json")) }],
      }),
    );
  }
  return root;
}

test("clock reads whole seconds as m:ss, and h:mm:ss from an hour", () => {
  assert.equal(clock(372), "6:12");
  assert.equal(clock(5), "0:05");
  assert.equal(clock(3723), "1:02:03");
});

test("no bundle composes a file with no figure", () => {
  const data = compose(repo([]), null);
  assert.equal(data.bundle, null);
  assert.equal(data.figures, undefined);
  assert.deepEqual(check(data, repo([])), { problems: [], compared: true });
});

test("a bundle composes its figures, each linked to its source file", () => {
  const root = repo(["2026-10-24"]);
  const data = compose(root, "2026-10-24");
  assert.equal(data.sample, 1);
  assert.equal(data.source, "docs/reference-run/2026-10-24/manifest.json");
  assert.equal(data.manifestSha256, sha(path.join(root, data.source)));
  assert.deepEqual(data.models, ["claude-sonnet-4-5"]);
  assert.equal(data.evidence, `${EVIDENCE_BASE}docs/reference-run/2026-10-24/SUMMARY.md`);
  assert.deepEqual(
    data.figures.map((f) => [f.id, f.display, f.label]),
    [
      ["wallClock", "6:12", "issue → draft pull request"],
      ["modelCalls", "4", "model calls"],
      ["costCents", "$0.41", "on our own API key"],
      ["correctionRounds", "1", "correction round"],
    ],
  );
  assert.equal(data.figures[0].href, `${EVIDENCE_BASE}docs/reference-run/2026-10-24/run/manifest.json`);
  assert.equal(data.figures[2].href, `${EVIDENCE_BASE}docs/reference-run/2026-10-24/run/usage.csv`);
  assert.deepEqual(check(data, root).problems, []);
});

test("a figure the bundle did not measure is left out", () => {
  const data = compose(repo(["2026-10-24"], { correctionRounds: null }), "2026-10-24");
  assert.deepEqual(data.figures.map((f) => f.id), ["wallClock", "modelCalls", "costCents"]);
});

test("the newest bundle is the one to show", () => {
  const root = repo(["2026-10-24", "2026-11-02"]);
  assert.deepEqual(bundles(root), ["2026-10-24", "2026-11-02"]);
  const stale = compose(root, "2026-10-24");
  assert.match(check(stale, root).problems[0], /newest bundle is 2026-11-02/);
});

test("a missing source bundle fails the check", () => {
  const data = compose(repo(["2026-10-24"]), "2026-10-24");
  assert.match(check(data, repo([])).problems[0], /source bundle docs\/reference-run\/2026-10-24\/ is missing/);
});

test("a published bundle the page does not show fails the check", () => {
  assert.match(check(compose(repo([]), null), repo(["2026-10-24"])).problems[0], /shows no bundle/);
});

test("a figure edited by hand fails the check", () => {
  const root = repo(["2026-10-24"]);
  const data = compose(root, "2026-10-24");
  data.figures[2].display = "$0.04";
  assert.match(check(data, root).problems[0], /differs from what/);
});

test("a run manifest that does not match its checksum is refused", () => {
  const root = repo(["2026-10-24"]);
  fs.appendFileSync(path.join(root, BUNDLES, "2026-10-24", "run", "manifest.json"), " ");
  assert.throws(() => compose(root, "2026-10-24"), /does not match the checksum/);
  const data = JSON.parse(JSON.stringify(compose(repo(["2026-10-24"]), "2026-10-24")));
  assert.match(check(data, root).problems[0], /does not match the checksum/);
});

test("out of the bundle's reach only the shape is checked", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reference-run-"));
  const data = compose(repo(["2026-10-24"]), "2026-10-24");
  assert.equal(bundles(root), null);
  assert.deepEqual(check(data, root), { problems: [], compared: false });
});

test("the shape refuses a rate, a percentage, a per-merge cost and an outside link", () => {
  const good = compose(repo(["2026-10-24"]), "2026-10-24");
  const bad = (edit) => {
    const d = JSON.parse(JSON.stringify(good));
    edit(d);
    return shapeProblems(d);
  };
  assert.deepEqual(shapeProblems(good), []);
  assert.match(bad((d) => (d.figures[0].display = "92%")).join(), /rate or percentage/);
  assert.match(bad((d) => (d.figures[2].label = "per merged PR")).join(), /rate or percentage/);
  assert.match(bad((d) => (d.figures[1].label = "merge rate")).join(), /rate or percentage/);
  assert.match(bad((d) => (d.figures[0].href = "https://example.com/")).join(), /does not link a file in its bundle/);
  assert.match(bad((d) => (d.sample = 30)).join(), /sample/);
  assert.match(bad((d) => (d.bundle = "acme")).join(), /must be null or a bundle date/);
  assert.match(shapeProblems({ bundle: null, figures: [] }).join(), /no bundle carries figures/);
});

test("the committed data file passes the check against this checkout", () => {
  const data = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, "data", "reference-run.json"), "utf8"));
  assert.deepEqual(check(data, path.dirname(WEB_ROOT)).problems, []);
});

test("the page carries none of the demonstration tenant's figures", () => {
  const page = ["app/page.tsx", "app/reference-run.tsx"].map((f) => fs.readFileSync(path.join(WEB_ROOT, f), "utf8")).join("\n");
  for (const fictional of ["92%", "$1.87", "31%", "~4 min", "acme-robotics", "1,284"]) {
    assert.ok(!page.includes(fictional), `the page still says ${fictional}`);
  }
  // Naming the metric is fine ("cost per merged PR"); stating a cost per merged PR is not.
  assert.doesNotMatch(page, /\$\d[\d.,]*\s*(<[^>]*>\s*)*per merged/);
  assert.match(page, /stops at a draft pull request/);
  assert.match(page, /n = 1/);
});

test("the page announces RC1 and links each new feature to its documentation", async () => {
  const release = await import("../app/release.ts");
  assert.equal(release.RELEASE, "RC1");
  assert.equal(release.RELEASE_NOTES_URL, "https://docs.ouroboros.build/releases/rc1");
  assert.ok(release.RELEASE_FEATURES.length >= 6);
  for (const f of release.RELEASE_FEATURES) {
    assert.ok(f.href.startsWith("https://docs.ouroboros.build/"), `${f.title} links outside the docs`);
    assert.doesNotMatch(`${f.title} ${f.copy}`, /\d+(\.\d+)?\s?%|per merged/, `${f.title} states a rate`);
  }
  assert.match(release.RELEASE_LIMITS, /draft pull requests only/);
  const page = fs.readFileSync(path.join(WEB_ROOT, "app/page.tsx"), "utf8");
  const section = fs.readFileSync(path.join(WEB_ROOT, "app/release-section.tsx"), "utf8");
  assert.match(page, /<ReleasePill \/>/);
  assert.match(page, /<ReleaseSection \/>/);
  assert.match(page, /href="#rc1">RC1</);
  assert.match(section, /id="rc1"/);
  assert.match(section, /href=\{RELEASE_NOTES_URL\}/);
});
