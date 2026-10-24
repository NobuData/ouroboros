#!/usr/bin/env sh
#
# reference-bundle.sh — turn a real reference run into its published evidence bundle (DL.3, #1327).
#
# scripts/reference-run.sh (DL.2) leaves an export directory behind. This script takes the export
# of the attempt being published, the export of every attempt before it, the screen recording and
# the operator's notes, and writes one directory:
#
#   docs/reference-run/<date>/
#     SUMMARY.md        what was measured, what this does not show, the attempts, the recording
#     manifest.json     every file's SHA-256, the recording's URL and SHA-256, and each figure
#                       with the file and the rule it was computed from
#     run/              the published attempt's export, byte for byte
#     attempts/<n>/     each earlier attempt's export, byte for byte, oldest first
#     cuts.txt          the waiting time cut from the recording, one marked cut per line
#     manual-steps.txt  every step a person took by hand during the run (empty: none)
#
# It computes every figure on SUMMARY.md from a file in the bundle and says which; it composes
# no figure of its own and states no rate or percentage (one run is not a sample — L13).
#
# The recording is not copied: it is too large for git. Upload it first (a release asset — see
# docs/DEMONSTRATION_LIVE_LOOP.md § Publish the evidence) and pass its URL; the manifest keeps the
# URL with the local file's SHA-256 and size, so anyone can check the download.
#
# It refuses what would make the bundle a re-enactment or a selection: an export made with
# --fixture, a transcript with a simulated event, a published attempt that did not open its pull
# request, an earlier attempt that is not a real export, a malformed cut, and a bundle directory
# that already exists (a bundle is written once).
#
# Usage:
#   scripts/reference-bundle.sh --export DIR --recording FILE --recording-url URL \
#     --cuts FILE --manual-steps FILE --operator NAME [--attempt DIR]... [--date YYYY-MM-DD]
#
# Options:
#   --export DIR         the published attempt's export directory (required)
#   --attempt DIR        an earlier attempt's export directory; repeat it, oldest first
#   --recording FILE     the screen recording, queue to draft pull request (required)
#   --recording-url URL  where the recording was uploaded, https (required)
#   --cuts FILE          the cuts list (required): one cut per line, "AT LENGTH WHAT" — AT is the
#                        cut's position in the published recording and LENGTH the waiting time
#                        removed, both HH:MM:SS; lines starting with # are comments
#   --manual-steps FILE  the steps a person took by hand (required; a file with no lines = none)
#   --operator NAME      who performed the run (required)
#   --date YYYY-MM-DD    the bundle's date (default: the day, UTC, the published attempt started)
#   --out DIR            where bundles live (default docs/reference-run)
#
# Exit status:
#   0  the bundle is written
#   2  a missing or refused input; nothing is written

set -eu

unset CDPATH
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
NAME=reference-bundle

say() { printf '%s: %s\n' "$NAME" "$*" >&2; }
die() { say "$*"; exit 2; }

EXPORT=''
ATTEMPTS=''
ATTEMPT_COUNT=0
RECORDING=''
RECORDING_URL=''
CUTS=''
MANUAL=''
OPERATOR=''
DATE=''
OUT="$ROOT/docs/reference-run"

while [ $# -gt 0 ]; do
  case $1 in
    --export) [ $# -ge 2 ] || die '--export needs a directory'; EXPORT=$2; shift 2 ;;
    --attempt)
      [ $# -ge 2 ] || die '--attempt needs a directory'
      ATTEMPT_COUNT=$((ATTEMPT_COUNT + 1))
      # Newline-separated, so a path with a space survives; the loop below reads it line by line.
      ATTEMPTS="$ATTEMPTS$2
"
      shift 2
      ;;
    --recording) [ $# -ge 2 ] || die '--recording needs a file'; RECORDING=$2; shift 2 ;;
    --recording-url) [ $# -ge 2 ] || die '--recording-url needs a URL'; RECORDING_URL=$2; shift 2 ;;
    --cuts) [ $# -ge 2 ] || die '--cuts needs a file'; CUTS=$2; shift 2 ;;
    --manual-steps) [ $# -ge 2 ] || die '--manual-steps needs a file'; MANUAL=$2; shift 2 ;;
    --operator) [ $# -ge 2 ] || die '--operator needs a name'; OPERATOR=$2; shift 2 ;;
    --date) [ $# -ge 2 ] || die '--date needs YYYY-MM-DD'; DATE=$2; shift 2 ;;
    --out) [ $# -ge 2 ] || die '--out needs a directory'; OUT=$2; shift 2 ;;
    -h | --help) sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

# --- what it was given -----------------------------------------------------------------------------
[ -n "$EXPORT" ] || die '--export is required'
[ -n "$RECORDING" ] || die '--recording is required'
[ -n "$RECORDING_URL" ] || die '--recording-url is required (upload the recording first)'
[ -n "$CUTS" ] || die '--cuts is required (a file with no cuts says so)'
[ -n "$MANUAL" ] || die '--manual-steps is required (a file with no steps says so)'
[ -n "$OPERATOR" ] || die '--operator is required'
case $RECORDING_URL in https://*) ;; *) die '--recording-url must be an https URL' ;; esac
[ -f "$RECORDING" ] || die "no recording at $RECORDING"
[ -s "$RECORDING" ] || die "the recording at $RECORDING is empty"
[ -f "$CUTS" ] || die "no cuts file at $CUTS"
[ -f "$MANUAL" ] || die "no manual-steps file at $MANUAL"
[ -z "$DATE" ] || printf '%s' "$DATE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' ||
  die "--date must be YYYY-MM-DD, not $DATE"
command -v node > /dev/null 2>&1 || die 'node is required'

# sha256 FILE — the file's SHA-256 in hex (sha256sum on Linux, shasum on macOS).
sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM

# --- validate every input before anything is written ----------------------------------------------
# check.mjs reads an export directory and refuses what a published bundle may not hold; with
# "published" it also requires the run to have opened its pull request. It prints the export's
# start date (UTC) so the bundle can be dated by it.
cat > "$work/check.mjs" << 'JS'
import fs from "node:fs";
import path from "node:path";

const [dir, role] = process.argv.slice(2);
const refuse = (why) => {
  process.stderr.write(`reference-bundle: ${dir}: ${why}\n`);
  process.exit(2);
};
const files = ["manifest.json", "run.jsonl", "usage.csv", "farm-job.log", "pr-url.txt", "run.json"];
for (const f of files) {
  if (!fs.existsSync(path.join(dir, f))) refuse(`not a reference-run export — no ${f}`);
}
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
} catch {
  refuse("manifest.json is not JSON");
}
if (manifest.mode !== "real") refuse(`made with --fixture (mode "${manifest.mode}"), not a real run — it cannot be published`);
const lines = fs.readFileSync(path.join(dir, "run.jsonl"), "utf8").split("\n").filter(Boolean);
lines.forEach((line, i) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    refuse(`run.jsonl line ${i + 1} is not JSON`);
  }
  if (event.simulated !== false) refuse(`run.jsonl line ${i + 1} is not marked "simulated": false`);
});
if (role === "published") {
  if (manifest.outcome !== "pr_opened") refuse(`the run did not open its pull request (outcome "${manifest.outcome}")`);
  if (!manifest.pullRequest) refuse("the manifest names no pull request");
  if (lines.length === 0) refuse("run.jsonl is empty");
}
process.stdout.write(String(manifest.started || "").slice(0, 10));
JS

EXPORT=$(cd -- "$EXPORT" 2> /dev/null && pwd) || die "no export directory at $EXPORT"
started_day=$(node "$work/check.mjs" "$EXPORT" published)
n=0
printf '%s' "$ATTEMPTS" > "$work/attempts"
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  n=$((n + 1))
  [ -d "$dir" ] || die "no attempt directory at $dir"
  node "$work/check.mjs" "$dir" earlier > /dev/null
done < "$work/attempts"

# A cut is "AT LENGTH WHAT": two HH:MM:SS times and a reason; a comment or a blank line is not one.
line_no=0
while IFS= read -r line || [ -n "$line" ]; do
  line_no=$((line_no + 1))
  case $line in '' | '#'*) continue ;; esac
  printf '%s\n' "$line" | grep -Eq '^[0-9]{2}:[0-5][0-9]:[0-5][0-9] +[0-9]{2}:[0-5][0-9]:[0-5][0-9] +[^ ].*$' ||
    die "cuts line $line_no is not \"HH:MM:SS HH:MM:SS what was cut\": $line"
done < "$CUTS"

[ -n "$DATE" ] || DATE=$started_day
[ -n "$DATE" ] || die 'the export records no start time; pass --date'
DEST="$OUT/$DATE"
[ ! -e "$DEST" ] || die "${DEST#"$ROOT"/} already exists — a bundle is written once"

# --- write it ---------------------------------------------------------------------------------------
mkdir -p "$DEST/run"
cp -p "$EXPORT"/* "$DEST/run/"
n=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  n=$((n + 1))
  mkdir -p "$DEST/attempts/$n"
  cp -p "$dir"/* "$DEST/attempts/$n/"
done < "$work/attempts"
cp "$CUTS" "$DEST/cuts.txt"
cp "$MANUAL" "$DEST/manual-steps.txt"

RECORDING_SHA=$(sha256 "$RECORDING")
RECORDING_BYTES=$(wc -c < "$RECORDING" | tr -d ' ')

# The checksum list: every file in the bundle but the two composed below, sorted by path.
(cd -- "$DEST" && find . -type f | sed 's|^\./||' | LC_ALL=C sort) > "$work/files"
: > "$work/sums"
while IFS= read -r f; do
  printf '%s %s\n' "$(sha256 "$DEST/$f")" "$f" >> "$work/sums"
done < "$work/files"

# compose.mjs computes the figures from the bundle's own files and writes manifest.json and
# SUMMARY.md. Each figure carries the file and the rule it came from, and SUMMARY.md prints both.
cat > "$work/compose.mjs" << 'JS'
import fs from "node:fs";
import path from "node:path";

const [dest, sumsPath] = process.argv.slice(2);
const env = process.env;
const read = (f) => fs.readFileSync(path.join(dest, f), "utf8");
const run = JSON.parse(read("run/manifest.json"));
const detail = JSON.parse(read("run/run.json"));

/** Parses one CSV line as psql writes it: commas, and double quotes around a field that needs them. */
const csvLine = (line) => {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(field); field = ""; }
    else field += c;
  }
  out.push(field);
  return out;
};

/** `372` → `6m 12s`; `null` stays `null`. */
const duration = (s) => {
  if (s === null || s === undefined || Number.isNaN(s)) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h ? `${h}h` : "", h || m ? `${m}m` : "", `${r}s`].filter(Boolean).join(" ");
};
/** `HH:MM:SS` → seconds. */
const seconds = (t) => t.split(":").reduce((a, b) => a * 60 + Number(b), 0);

// usage.csv — one row per metered model call.
const [header, ...rows] = read("run/usage.csv").split("\n").filter(Boolean).map(csvLine);
const col = (name) => header.indexOf(name);
const sum = (name) => rows.reduce((a, r) => a + Number(r[col(name)] || 0), 0);

// run.json — the stepper: the implement stage's attempts, and every attempt of a stage that
// submitted a farm job.
const stages = (detail.timeline && detail.timeline.stages) || [];
const implement = stages.find((s) => s.stageKey === "implement");
const builds = stages.filter((s) => s.build).flatMap((s) => s.attempts || []);
const buildSeconds = builds.every((a) => a.durationSeconds !== null)
  ? builds.reduce((a, b) => a + b.durationSeconds, 0)
  : null;

const wall = Math.round((Date.parse(run.finished) - Date.parse(run.started)) / 1000);
const costCents = sum("cost_cents");
const figures = [
  {
    id: "wallClock",
    label: "Wall-clock, queue to draft pull request",
    value: wall,
    display: duration(wall),
    source: "run/manifest.json",
    rule: "finished − started: the script's clock from queueing the issue to the poll that saw the pull request",
  },
  {
    id: "modelCalls",
    label: "Model calls",
    value: rows.length,
    display: String(rows.length),
    source: "run/usage.csv",
    rule: "the number of rows (one per metered call)",
  },
  {
    id: "tokensIn",
    label: "Tokens in",
    value: sum("tokens_in"),
    display: sum("tokens_in").toLocaleString("en-US"),
    source: "run/usage.csv",
    rule: "the sum of tokens_in",
  },
  {
    id: "tokensOut",
    label: "Tokens out",
    value: sum("tokens_out"),
    display: sum("tokens_out").toLocaleString("en-US"),
    source: "run/usage.csv",
    rule: "the sum of tokens_out",
  },
  {
    id: "costCents",
    label: "Cost, customer-key price list",
    value: costCents,
    display: `$${(costCents / 100).toFixed(2)}`,
    source: "run/usage.csv",
    rule: "the sum of cost_cents, as metered at the provider's list price for the customer's own key",
  },
  {
    id: "correctionRounds",
    label: "Correction rounds",
    value: implement ? Math.max((implement.attempts || []).length - 1, 0) : null,
    display: implement ? String(Math.max((implement.attempts || []).length - 1, 0)) : "not recorded",
    source: "run/run.json",
    rule: "the implement stage's attempts after its first (timeline.stages[implement].attempts)",
  },
  {
    id: "buildSeconds",
    label: "Build duration",
    value: buildSeconds,
    display: builds.length === 0 ? "no build ran" : `${duration(buildSeconds) ?? "not recorded"} over ${builds.length} build attempt${builds.length === 1 ? "" : "s"}`,
    source: "run/run.json",
    rule: "the sum of durationSeconds over every attempt of a stage that submitted a farm job",
  },
];

// The attempts, oldest first, then the published one.
const earlier = fs.existsSync(path.join(dest, "attempts"))
  ? fs.readdirSync(path.join(dest, "attempts")).sort((a, b) => Number(a) - Number(b))
  : [];
const attempts = earlier.map((n) => {
  const m = JSON.parse(read(`attempts/${n}/manifest.json`));
  return { attempt: Number(n), directory: `attempts/${n}/`, started: m.started, outcome: m.outcome, run: m.run, published: false };
});
attempts.push({ attempt: earlier.length + 1, directory: "run/", started: run.started, outcome: run.outcome, run: run.run, published: true });

const cuts = read("cuts.txt").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => {
  const [at, length, ...what] = l.trim().split(/ +/);
  return { at, length, what: what.join(" ") };
});
const cutSeconds = cuts.reduce((a, c) => a + seconds(c.length), 0);
const manual = read("manual-steps.txt").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
const files = fs.readFileSync(sumsPath, "utf8").split("\n").filter(Boolean).map((l) => {
  const [sha256, ...p] = l.split(" ");
  return { path: p.join(" "), sha256 };
});
const models = Object.entries(run.aliases || {});
const distinctModels = [...new Set(models.map(([, m]) => m))];

const manifest = {
  bundle: env.DATE,
  operator: env.OPERATOR,
  repository: run.repository,
  issue: run.issue,
  run: run.run,
  pullRequest: run.pullRequest,
  checkout: run.checkout,
  attemptsBeforePublished: earlier.length,
  attempts,
  recording: { url: env.RECORDING_URL, sha256: env.RECORDING_SHA, bytes: Number(env.RECORDING_BYTES), cuts: cuts.length, cutSeconds },
  figures: figures.map(({ id, label, value, source, rule }) => ({ id, label, value, source, rule })),
  files,
  disclosure: "The change in this run's pull request was generated by an automated loop (Ouroboros).",
};
fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const md = [];
md.push(`# Reference run — ${env.DATE}`, "");
md.push(
  "> **AI disclosure.** The change in this run's pull request was generated by an automated loop",
  "> (Ouroboros), not written by a person. The pull request says so in its first line — *Opened by",
  "> an Ouroboros loop under dry-run policy* — and the recording shows the loop doing it.",
  "",
);
md.push(
  `One live run of the loop on [${run.repository}#${run.issue}](https://github.com/${run.repository}/issues/${run.issue}),`,
  `performed by ${env.OPERATOR} with \`scripts/reference-run.sh\` at ${run.checkout && run.checkout.tag ? `tag \`${run.checkout.tag}\`` : `commit \`${run.checkout && run.checkout.commit}\``}.`,
  `It opened the draft pull request ${run.pullRequest}. This is attempt ${earlier.length + 1}; ${plural(earlier.length, "attempt", "attempts")} preceded it.`,
  "",
);
md.push("## What was measured", "");
md.push("| Figure | Value | From | How |", "| --- | --- | --- | --- |");
for (const f of figures) md.push(`| ${f.label} | **${f.display}** | [\`${f.source}\`](${f.source}) | ${f.rule} |`);
md.push("", `Every figure is in [\`manifest.json\`](manifest.json) with the same source and rule. None is a rate or a percentage.`, "");

md.push("## What this does not show", "");
md.push(
  "- **One run.** n = 1. Nothing here is a rate, an average or a success percentage, and none can be drawn from it.",
  `- **One repository** — ${run.repository}, a small sample repository, not a customer's codebase.`,
  `- **One model** per stage — ${models.map(([a, m]) => `\`${a}\` → \`${m}\``).join(", ")}${distinctModels.length > 1 ? "" : " (one concrete model)"}. Another model, or the same one on another day, writes a different change.`,
  `- **An issue chosen by the authors** — #${run.issue}, picked because the loop could plausibly do it, not drawn at random.`,
  "- **No merge.** Dry-run was on, so the pull request is a draft; nobody reviewed or merged it as part of this run.",
  "- **The L5 restrictions were in force** — the agent had file tools only, inside one working tree: no shell, no network tool, no MCP, no repository-supplied settings or hooks; code ran only on the runner. A loop without them is not shown.",
  `- **Manual steps.** ${manual.length === 0 ? "None was taken (see [`manual-steps.txt`](manual-steps.txt))." : `${plural(manual.length, "step was", "steps were")} taken by hand — see [\`manual-steps.txt\`](manual-steps.txt):`}`,
  ...manual.map((m) => `  - ${m.trim()}`),
  `- **Cut waiting time.** The recording has ${plural(cuts.length, "marked cut", "marked cuts")} removing ${duration(cutSeconds)} of waiting; nothing else was edited, and nothing was re-enacted.`,
  `- **The attempts before it.** ${earlier.length === 0 ? "None — this was the first attempt." : `${plural(earlier.length, "attempt", "attempts")} came first and ${earlier.length === 1 ? "is" : "are"} kept below, not discarded.`}`,
  "",
  "Reviewed by: _pending — someone who did not perform the run._",
  "",
);

md.push("## Attempts", "");
md.push("| Attempt | Started | Outcome | Run | Files |", "| --- | --- | --- | --- | --- |");
for (const a of attempts) md.push(`| ${a.attempt}${a.published ? " (published)" : ""} | ${a.started} | \`${a.outcome}\` | ${a.run ? `\`${a.run}\`` : "—"} | [\`${a.directory}\`](${a.directory}) |`);
md.push("");

md.push("## The recording", "");
md.push(
  `[Watch or download it](${env.RECORDING_URL}) — ${(Number(env.RECORDING_BYTES) / 1048576).toFixed(1)} MiB, SHA-256 \`${env.RECORDING_SHA}\`.`,
  "It runs unedited from queueing the issue to the draft pull request, except for these cuts of waiting time, each marked on screen:",
  "",
);
if (cuts.length === 0) md.push("_No cuts._", "");
else {
  md.push("| At | Waiting cut | What was waiting |", "| --- | --- | --- |");
  for (const c of cuts) md.push(`| ${c.at} | ${c.length} | ${c.what} |`);
  md.push("");
}
md.push("Check a download with `sha256sum` against the value above (also in `manifest.json`).", "");

md.push("## Files", "");
md.push("| File | SHA-256 |", "| --- | --- |");
for (const f of files) md.push(`| [\`${f.path}\`](${f.path}) | \`${f.sha256.slice(0, 16)}…\` |`);
md.push("", "The full digests are in [`manifest.json`](manifest.json).", "");
fs.writeFileSync(path.join(dest, "SUMMARY.md"), md.join("\n"));
JS

DATE=$DATE OPERATOR=$OPERATOR RECORDING_URL=$RECORDING_URL RECORDING_SHA=$RECORDING_SHA \
  RECORDING_BYTES=$RECORDING_BYTES node "$work/compose.mjs" "$DEST" "$work/sums" ||
  { rm -rf "$DEST"; die 'composing the summary failed; nothing was written'; }

say "wrote ${DEST#"$ROOT"/}/ — attempt $((ATTEMPT_COUNT + 1)), $ATTEMPT_COUNT before it"
