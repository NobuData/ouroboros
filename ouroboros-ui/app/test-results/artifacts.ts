/**
 * The artifacts card, as data ([#341](https://github.com/NobuData/ouroboros/issues/341)) — mockup
 * 11's `retained 30d` tag and `art` rows, decided here and drawn by `artifacts-card.tsx`.
 *
 * **The retention tag is the payload's, never a constant** ({@link retentionTag}). Each artifact
 * carries the days the workspace's policy gave it when it was uploaded, and the tag is composed
 * from those: `retained 30d` where the policy is thirty days, `retained 7d` where it is seven. An
 * attempt with no live file makes no promise, so it draws no tag.
 *
 * **An expired artifact is a row, not an absence** ({@link artifactsView}). The retention sweep
 * leaves a tombstone, and it is drawn under its original name as `expired`, with nothing to open
 * — so *it expired* and *it was never uploaded* are two different things to read.
 *
 * **A truncated upload says so, with its reason** ({@link truncationLine}).
 *
 * **The coverage delta is absent, not zero** ({@link coverageLine}). A first attempt has nothing
 * to be measured against, and prints `coverage 87.4%` alone — never `(+0.0%)`.
 *
 * **Opening splits by what the payload says** (`preview`): `inline` is read in place by the
 * card's viewer ({@link readArtifactText}); `download` is saved. Both go through this origin's
 * `/api/artifacts/:id` ({@link artifactUrl}), which is built from the artifact's id — nothing
 * about where a file is kept is in the payload, and nothing is put in the page.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { TestArtifact, TestCoverage, TestRunPage } from "@/app/api/test-results";

/** The card's title — the mockup's `ARTIFACTS`. */
export const ARTIFACTS_TITLE = "Artifacts";

/** What the card says while the attempt's page has not been read. */
export const READING_ARTIFACTS = "Reading the artifacts…";

/** What the card says when the attempt uploaded nothing and measured no coverage. */
export const NO_ARTIFACTS = "This build uploaded no artifacts.";

/** What the list is called. */
export const ARTIFACTS_LIST_LABEL = "Artifacts of this build";

/** A tombstone's state. */
export const EXPIRED = "expired";

/** A cut-short upload's state. */
export const TRUNCATED = "truncated";

/** What the coverage row is called — the mockup's `coverage 87.4% (+0.6%)`. */
export const COVERAGE_LABEL = "coverage";

/** The affordance's glyph — the mockup's `↗`. */
export const OPEN_GLYPH = "↗";

/** What closes the inline viewer. */
export const CLOSE_VIEWER = "Close";

/** What the inline viewer's own download link says. */
export const DOWNLOAD_FILE = "Download";

/** What the inline viewer says while it reads. */
export const READING_FILE = "Reading the file…";

/** What the inline viewer says of a file the retention sweep removed while the page was open. */
export const FILE_EXPIRED = "This artifact has expired — its file is no longer stored.";

/** What the inline viewer says when the session ended. */
export const FILE_SIGNED_OUT = "Your session has ended — sign in again to read this file.";

/** What the inline viewer says when nothing answered. */
export const FILE_UNREACHABLE = "The file could not be reached.";

/** What the inline viewer says when the answer carried no sentence of its own. */
export const FILE_UNREADABLE = "The file could not be read.";

/** What the inline viewer's banner says over the reason a file could not be opened. */
export const FILE_FAILED_HEADLINE = "The file could not be opened.";

/** What the inline viewer says of a file with nothing in it. */
export const FILE_EMPTY = "This file is empty.";

/** Where the browser asks for an artifact's file — this origin, `/api/artifacts/:id`. */
export const ARTIFACT_ENDPOINT = "/api/artifacts";

/** The size from which a row prints it — the mockup prints `2.1 MB` and no `48 KB`. */
export const NOTABLE_BYTES = 1024 * 1024;

/** The most of a file the inline viewer reads; the rest is the download's. */
export const PREVIEW_LIMIT_BYTES = 512 * 1024;

/** What each kind of artifact is, in words — the row's icon, said. */
export const KIND_LABEL: Readonly<Record<TestArtifact["kind"], string>> = {
  junit: "JUnit report",
  hil: "HIL results",
  coverage: "coverage report",
  log: "log",
  capture: "rig capture",
  other: "file",
};

/** The units a size is printed in, each 1024 of the one before. */
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** One step between units. */
const UNIT_STEP = 1024;

/** The hue a coverage delta takes. */
export type DeltaTone = "ok" | "err" | "neutral";

/** A coverage delta — the mockup's `(+0.6%)`. */
export interface CoverageDeltaView {
  /** `(+0.6%)`, `(−1.2%)`. */
  readonly text: string;
  /** `ok` for a rise, `err` for a fall, `neutral` for a measured *no change*. */
  readonly tone: DeltaTone;
}

/** The coverage row's figures. */
export interface CoverageLineView {
  /** `87.4%`. */
  readonly percent: string;
  /** The delta, or `null` when no earlier attempt has coverage. */
  readonly delta: CoverageDeltaView | null;
  /** The whole line as one string — `coverage 87.4% (+0.6%)`. */
  readonly text: string;
}

/** How a row opens. */
export interface ArtifactOpenView {
  /** `inline` — read in place; `download` — saved. */
  readonly mode: "inline" | "download";
  /** The file, on this origin. */
  readonly url: string;
  /** The affordance's accessible name — `Open junit-build3.xml`, `Download rig-capture-estop.csv`. */
  readonly label: string;
}

/** One row of the card. */
export interface ArtifactRowView {
  /** What keys the row. */
  readonly key: string;
  /** The artifact's id, or `null` for a coverage row no file stands behind. */
  readonly artifactId: string | null;
  /** The file's name, as it was uploaded — kept on a tombstone. */
  readonly name: string;
  /** The artifact's kind, which chooses the row's icon. */
  readonly kind: TestArtifact["kind"];
  /** {@link KIND_LABEL}'s words for the kind. */
  readonly kindLabel: string;
  /** `2.1 MB`, or `null` for a size that is not notable. */
  readonly size: string | null;
  /** The coverage figures, on the coverage row; `null` on every other. */
  readonly coverage: CoverageLineView | null;
  /** Whether the retention sweep removed the file — a tombstone. */
  readonly expired: boolean;
  /** `Cut short on upload — exceeded the 25 MB per-file cap`, or `null` for a whole file. */
  readonly truncation: string | null;
  /** How the row opens, or `null` when there is nothing to open. */
  readonly open: ArtifactOpenView | null;
}

/** The artifacts card. */
export interface ArtifactsView {
  /** `retained 30d`, or `null` when no live file is on the card. */
  readonly tag: string | null;
  readonly rows: readonly ArtifactRowView[];
  /** What the card says in place of rows, or `null` when it has some. */
  readonly note: string | null;
}

/** What reading a file for the inline viewer found. */
export type ArtifactText =
  | {
      readonly state: "read";
      readonly text: string;
      /** Whether the file is longer than what was read. */
      readonly clipped: boolean;
    }
  | { readonly state: "expired" }
  | { readonly state: "failed"; readonly reason: string };

/** The wiring of {@link readArtifactText} that tests replace. */
export interface ArtifactTextOptions {
  /** How to fetch. Defaults to the global. */
  readonly fetcher?: typeof fetch;
  /** The most bytes to read. Defaults to {@link PREVIEW_LIMIT_BYTES}. */
  readonly limitBytes?: number;
  /** Aborts the read — the viewer closing. */
  readonly signal?: AbortSignal;
}

// --- figures ------------------------------------------------------------------------------------

/**
 * The address of an artifact's file on this origin.
 *
 * @param id The artifact's id.
 * @returns `/api/artifacts/<id>`, the id encoded.
 */
export function artifactUrl(id: string): string {
  return `${ARTIFACT_ENDPOINT}/${encodeURIComponent(id)}`;
}

/**
 * A size, in the unit that reads best.
 *
 * @param bytes The size in bytes.
 * @returns `2.1 MB`, `180.0 KB`, `512 B` — binary units, one decimal above bytes. A size that is
 *   not a non-negative finite number is `null`.
 */
export function formatBytes(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes < 0) return null;

  let value = bytes;
  let unit = 0;
  while (value >= UNIT_STEP && unit < UNITS.length - 1) {
    value /= UNIT_STEP;
    unit += 1;
  }

  return unit === 0 ? `${String(value)} ${UNITS[unit]}` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/**
 * The size a row prints.
 *
 * @param bytes The artifact's size in bytes.
 * @returns The size from {@link NOTABLE_BYTES} up — `2.1 MB` — and `null` below it, where the
 *   mockup prints none.
 */
export function sizeLabel(bytes: number): string | null {
  return bytes >= NOTABLE_BYTES ? formatBytes(bytes) : null;
}

/**
 * The card's retention tag, from the artifacts' own retention.
 *
 * @param artifacts The attempt's artifacts.
 * @returns `retained 30d` when every live file is kept the same number of days;
 *   `retained 7–30d` when the policy changed between uploads; `null` when there is no live file
 *   with a readable retention — an expired one is no longer retained at all.
 */
export function retentionTag(artifacts: readonly TestArtifact[]): string | null {
  const days = artifacts
    .filter((each) => each.state !== "expired")
    .map((each) => each.retentionDays)
    .filter((each) => Number.isFinite(each) && each > 0);

  if (days.length === 0) return null;

  const least = Math.min(...days);
  const most = Math.max(...days);

  return least === most ? `retained ${least}d` : `retained ${least}–${most}d`;
}

/**
 * The coverage row's figures.
 *
 * @param coverage The attempt's coverage.
 * @returns The percent to one decimal, and the delta in percentage points with its sign and its
 *   hue. **The delta is `null` when the payload carries none** — there is no earlier attempt to
 *   measure against — and is never invented as `+0.0%`. A delta that was measured and is zero is
 *   printed `(±0.0%)`, neutral.
 */
export function coverageLine(coverage: TestCoverage): CoverageLineView {
  const percent = `${coverage.percent.toFixed(1)}%`;
  const measured = typeof coverage.delta === "number" && Number.isFinite(coverage.delta);
  let delta: CoverageDeltaView | null = null;

  if (measured) {
    const points = Number(coverage.delta!.toFixed(1));
    const size = `${Math.abs(points).toFixed(1)}%`;

    if (points > 0) delta = { text: `(+${size})`, tone: "ok" };
    else if (points < 0) delta = { text: `(−${size})`, tone: "err" };
    else delta = { text: `(±${size})`, tone: "neutral" };
  }

  return {
    percent,
    delta,
    text: [COVERAGE_LABEL, percent, delta?.text ?? null].filter((part) => part !== null).join(" "),
  };
}

/**
 * What a truncated row says.
 *
 * @param artifact The artifact.
 * @returns `Cut short on upload — <reason>`, the reason being the upload's own note;
 *   `Cut short on upload` when it left none; `null` for a file that was stored whole.
 */
export function truncationLine(
  artifact: Pick<TestArtifact, "truncated" | "truncationNote">,
): string | null {
  const note = artifact.truncationNote?.trim() ?? "";

  if (!artifact.truncated && note === "") return null;

  return note === "" ? "Cut short on upload" : `Cut short on upload — ${note}`;
}

/**
 * How a row opens.
 *
 * @param artifact The artifact.
 * @returns The viewer for an `inline` one and the download for any other — or `null` for a
 *   tombstone, and for an artifact the payload gives nothing to open (`href` is `null`).
 */
export function openOf(artifact: TestArtifact): ArtifactOpenView | null {
  if (artifact.state !== "available" || artifact.href === null) return null;

  const mode = artifact.preview === "inline" ? "inline" : "download";

  return {
    mode,
    url: artifactUrl(artifact.id),
    label: `${mode === "inline" ? "Open" : "Download"} ${artifact.name}`,
  };
}

// --- the card -----------------------------------------------------------------------------------

/**
 * One artifact's row.
 *
 * @param artifact The artifact.
 * @param coverage The coverage figures when this is the coverage row, else `null`.
 * @returns The row.
 */
function rowOf(artifact: TestArtifact, coverage: TestCoverage | null): ArtifactRowView {
  const expired = artifact.state === "expired";

  return {
    key: artifact.id,
    artifactId: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    kindLabel: KIND_LABEL[artifact.kind] ?? KIND_LABEL.other,
    size: expired ? null : sizeLabel(artifact.sizeBytes),
    coverage: coverage === null ? null : coverageLine(coverage),
    expired,
    truncation: truncationLine(artifact),
    open: openOf(artifact),
  };
}

/**
 * The artifacts card for one attempt.
 *
 * @param page The attempt's artifacts and its coverage.
 * @returns The tag, and one row per artifact in the payload's order — live, truncated or a
 *   tombstone — with **the coverage row last**, as the mockup draws it. The coverage row is the
 *   attempt's live coverage report, labelled with the figures and opening that file; when the
 *   report has expired it keeps its tombstone and the figures are drawn on a row of their own
 *   with nothing to open, because the summary is still true. With nothing to draw, the note.
 */
export function artifactsView(page: Pick<TestRunPage, "artifacts" | "coverage">): ArtifactsView {
  const artifacts = Array.isArray(page.artifacts) ? page.artifacts : [];
  const report =
    artifacts.find(
      (each) =>
        each.kind === "coverage" &&
        each.state === "available" &&
        (each.coverage ?? page.coverage ?? null) !== null,
    ) ?? null;
  const figures = report?.coverage ?? page.coverage ?? null;

  const rows = artifacts.filter((each) => each !== report).map((each) => rowOf(each, null));

  if (report !== null) rows.push(rowOf(report, figures));
  else if (figures !== null) {
    rows.push({
      key: COVERAGE_LABEL,
      artifactId: null,
      name: COVERAGE_LABEL,
      kind: "coverage",
      kindLabel: KIND_LABEL.coverage,
      size: null,
      coverage: coverageLine(figures),
      expired: false,
      truncation: null,
      open: null,
    });
  }

  return {
    tag: retentionTag(artifacts),
    rows,
    note: rows.length > 0 ? null : NO_ARTIFACTS,
  };
}

// --- the inline viewer's read -------------------------------------------------------------------

/**
 * The sentence a refusal carries, if it carries one.
 *
 * @param response The refusal.
 * @returns The envelope's `message`, or `null` when the body is not one.
 */
async function refusalMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown } | null)?.message;

    return typeof message === "string" && message.trim() !== "" ? message : null;
  } catch {
    return null;
  }
}

/**
 * Read an artifact's file as text, for the inline viewer.
 *
 * @param url The file, on this origin — {@link artifactUrl}.
 * @param options The wiring tests replace, and the viewer's abort signal.
 * @returns The text — at most `limitBytes` of it, `clipped` when the file is longer, so a log of
 *   any length costs the page a bounded amount; *expired* for a `410`; or a sentence about why
 *   not. Never a throw, but for an abort the caller asked for.
 */
export async function readArtifactText(
  url: string,
  options: ArtifactTextOptions = {},
): Promise<ArtifactText> {
  const {
    fetcher = (input, init) => fetch(input, init),
    limitBytes = PREVIEW_LIMIT_BYTES,
    signal,
  } = options;

  let response: Response;
  try {
    response = await fetcher(url, { cache: "no-store", credentials: "same-origin", signal });
  } catch (error) {
    if (signal?.aborted === true) throw error;

    return { state: "failed", reason: FILE_UNREACHABLE };
  }

  if (response.status === 410) return { state: "expired" };
  if (response.status === 401) return { state: "failed", reason: FILE_SIGNED_OUT };
  if (!response.ok) {
    return { state: "failed", reason: (await refusalMessage(response)) ?? FILE_UNREADABLE };
  }

  try {
    if (response.body === null) {
      const whole = await response.text();

      return { state: "read", text: whole.slice(0, limitBytes), clipped: whole.length > limitBytes };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let taken = 0;
    let clipped = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      const room = limitBytes - taken;
      if (value.byteLength > room) {
        text += decoder.decode(value.subarray(0, room), { stream: true });
        clipped = true;
        // The rest is the download's; the connection is let go rather than drained.
        await reader.cancel();
        break;
      }

      text += decoder.decode(value, { stream: true });
      taken += value.byteLength;
    }

    // A cut in the middle of a character leaves its first bytes behind; they are dropped.
    if (!clipped) text += decoder.decode();

    return { state: "read", text, clipped };
  } catch (error) {
    if (signal?.aborted === true) throw error;

    return { state: "failed", reason: FILE_UNREADABLE };
  }
}

/**
 * What the viewer says under a file it read only the start of.
 *
 * @param limitBytes How much was read.
 * @returns `Showing the first 512.0 KB — download the file for the rest.`
 */
export function clippedNote(limitBytes: number = PREVIEW_LIMIT_BYTES): string {
  return `Showing the first ${formatBytes(limitBytes) ?? ""} — download the file for the rest.`;
}
