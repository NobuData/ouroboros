/**
 * The run console's right column, as data ([#313](https://github.com/NobuData/ouroboros/issues/313))
 * — mockup 10's *Changes so far*, *Resources* and *Guardrails* cards, from AP.2's payloads
 * ([#304](https://github.com/NobuData/ouroboros/issues/304)) and AP.3's verdicts
 * ([#305](https://github.com/NobuData/ouroboros/issues/305)).
 *
 * **All three cards are one lazy fallback away from lying**, so every rule here is about what
 * is *not* known:
 *
 * - **Unpriced is not free.** A cost nobody priced is `— · 212k tokens`, never `$0.00`
 *   (decision M7): `$0.00` reads as *free*, which is the opposite of *unknown*.
 * - **Absent is absent.** No pinned budget is a count with no meter — there is no denominator to
 *   invent — and no reservation is no farm row at all, not a row naming a runner nobody held.
 * - **The Guardrails pill is computed** from the verdicts on the card (see {@link guardrailPill}),
 *   never a static `clean`, and a check that did not run is a `○`, not a tick.
 * - **A commit links only when its source can build the URL** ({@link commitUrl}); otherwise the
 *   sha is plain text rather than a guessed link.
 *
 * Framework-free, so every rule is a unit test without rendering.
 */

import type { RunConsole, RunRepository } from "@/app/api/runs";
import { compactNumber, moneyOfCents } from "@/app/format";
import { meterTone } from "@/app/providers/cards";
import type { ChipDot, ChipTone, MeterTone } from "@/app/ui";

import { workflowCaption } from "./view";

/** *Changes so far* as the contract carries it. */
export type RunChanges = RunConsole["changes"];

/** *Resources* as the contract carries it. */
export type RunResources = RunConsole["resources"];

/** *Guardrails* as the contract carries it. */
export type RunGuardrails = RunConsole["guardrails"];

/** One guardrail verdict as the contract carries it. */
export type RunGuardrailCheck = RunGuardrails["checks"][number];

/** The farm reservation as the contract carries it. */
export type RunFarm = NonNullable<RunResources["farm"]>;

/** What stands where a figure nobody measured would be (decision M7). */
export const UNKNOWN = "—";

/** The minus the mockup prints before a deletion count — a real minus, not a hyphen. */
export const MINUS = "−";

// ---------------------------------------------------------------------------------------------
// Changes so far
// ---------------------------------------------------------------------------------------------

/** The card's title. */
export const CHANGES_TITLE = "Changes so far";

/** What the file list's scroll region is called. */
export const FILES_LABEL = "Changed files";

/** What the commit list's scroll region is called. */
export const COMMITS_LABEL = "Commits";

/** What the card says before the loop has changed anything. */
export const NO_FILES = "No files changed yet.";

/** What the card says before the loop has committed anything. */
export const NO_COMMITS = "No commits yet.";

/** The tag under the commits, per merge strategy — the mockup's *will squash on merge*. */
export const MERGE_TAG: Readonly<Record<NonNullable<RunChanges["mergeStrategy"]>, string>> = {
  squash: "will squash on merge",
  merge: "will merge with a merge commit",
  rebase: "will rebase on merge",
};

/**
 * Where a repository's commits live — a source that can build a commit's URL.
 *
 * The console's contract names the repository only as GitHub names it (`head.repository`), so
 * {@link commitSource} can only ever produce `github` today. The other two are here so that a
 * ticket source which is not GitHub has a builder waiting the day the contract carries one —
 * each is unit-tested, and none is guessed from a GitHub name.
 */
export type CommitSource =
  /** `github.com/{owner}/{name}/commit/{sha}`. */
  | { readonly kind: "github"; readonly owner: string; readonly name: string }
  /**
   * `{baseUrl}/{path}/-/commit/{sha}`. `path` is the project's full path, subgroups included
   * (`group/sub/project`); `baseUrl` is a self-managed instance, `https://gitlab.com` when
   * omitted.
   */
  | { readonly kind: "gitlab"; readonly path: string; readonly baseUrl?: string }
  /** `bitbucket.org/{workspace}/{name}/commits/{sha}`. */
  | { readonly kind: "bitbucket"; readonly workspace: string; readonly name: string };

/** A commit's name: hex, from an abbreviation (7) to a SHA-256 object name (64). */
const SHA = /^[0-9a-f]{7,64}$/i;

/** GitLab's own host, when a source names no instance. */
const GITLAB_COM = "https://gitlab.com";

/**
 * The source the console's contract lets this page name.
 *
 * @param repository The run's repository, or `undefined` when the service could not read it.
 * @returns A GitHub source, or `null` — the shas are then plain text.
 */
export function commitSource(repository: RunRepository | undefined): CommitSource | null {
  return repository === undefined ? null : { kind: "github", owner: repository.owner, name: repository.name };
}

/**
 * A path of segments, each encoded — `group/sub project` → `group/sub%20project`.
 *
 * @param path The path.
 * @returns It encoded, or `null` when it has an empty segment or a `.`/`..` one, which would
 *   point somewhere other than the project meant.
 */
function encodedPath(path: string): string | null {
  const segments = path.split("/");

  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;

  return segments.map(encodeURIComponent).join("/");
}

/**
 * A self-managed instance's origin, if it is a web address.
 *
 * @param baseUrl What the source named.
 * @returns Its origin and path with no trailing slash, or `null` for anything that is not an
 *   `http(s)` URL — a `javascript:` base would otherwise become a link.
 */
function webBase(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Where a commit is on its source — the accent sha's link.
 *
 * @param source The source, or `null` when there is none to build from.
 * @param sha The commit's name as reported — abbreviated or whole.
 * @returns The URL with every segment encoded, or `null` when the source cannot produce one:
 *   no source, a sha that is not hex, or a source whose parts do not make a path.
 */
export function commitUrl(source: CommitSource | null, sha: string): string | null {
  if (source === null || !SHA.test(sha)) return null;

  switch (source.kind) {
    case "github":
      if (source.owner === "" || source.name === "") return null;
      return (
        `https://github.com/${encodeURIComponent(source.owner)}/` +
        `${encodeURIComponent(source.name)}/commit/${sha}`
      );

    case "gitlab": {
      const base = webBase(source.baseUrl ?? GITLAB_COM);
      const path = encodedPath(source.path);

      return base === null || path === null ? null : `${base}/${path}/-/commit/${sha}`;
    }

    case "bitbucket":
      if (source.workspace === "" || source.name === "") return null;
      return (
        `https://bitbucket.org/${encodeURIComponent(source.workspace)}/` +
        `${encodeURIComponent(source.name)}/commits/${sha}`
      );
  }
}

/** A count with its noun, pluralised — `1 file`, `3 files`. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** One file row. */
export interface FileRowView {
  /** Unique within the card even if a report repeats a path. */
  readonly key: string;
  readonly path: string;
  /** `+38`. */
  readonly additions: string;
  /** `−12`. */
  readonly deletions: string;
  /** What a screen reader hears for the row — `drivers/can/a.c, 38 added, 12 removed`. */
  readonly accessibleName: string;
}

/** One commit row. */
export interface CommitRowView {
  readonly key: string;
  readonly shortSha: string;
  readonly subject: string;
  /** Where the sha links, or `null` for plain text. */
  readonly href: string | null;
}

/** *Changes so far*, ready to draw. */
export interface ChangesView {
  readonly files: readonly FileRowView[];
  readonly commits: readonly CommitRowView[];
  /** The head's tag — `3 files`. */
  readonly countLabel: string;
  /** The tag's tooltip — `+68 −15 across 3 files`. */
  readonly totalsLabel: string;
  /** *will squash on merge*, or `null` when the pinned terminal opens no pull request. */
  readonly mergeTag: string | null;
}

/**
 * *Changes so far*.
 *
 * **The totals are summed here, from the rows drawn** — not read from the payload's `totals` —
 * so the tag can never disagree with the list under it (decision R8).
 *
 * @param changes The payload.
 * @param source Where the commits link, or `null`.
 * @returns The card.
 */
export function changesView(changes: RunChanges, source: CommitSource | null): ChangesView {
  const additions = changes.files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = changes.files.reduce((sum, file) => sum + file.deletions, 0);
  const countLabel = counted(changes.files.length, "file");

  return {
    files: changes.files.map((file, index) => ({
      key: `${index}:${file.path}`,
      path: file.path,
      additions: `+${file.additions}`,
      deletions: `${MINUS}${file.deletions}`,
      accessibleName: `${file.path}, ${file.additions} added, ${file.deletions} removed`,
    })),
    commits: changes.commits.map((commit, index) => ({
      key: `${index}:${commit.sha}`,
      shortSha: commit.shortSha,
      subject: commit.subject,
      href: commitUrl(source, commit.sha),
    })),
    countLabel,
    totalsLabel: `+${additions} ${MINUS}${deletions} across ${countLabel}`,
    mergeTag: changes.mergeStrategy === null ? null : MERGE_TAG[changes.mergeStrategy],
  };
}

// ---------------------------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------------------------

/** The card's title. */
export const RESOURCES_TITLE = "Resources";

/** The rows' labels, as the mockup prints them. */
export const TOKENS_LABEL = "Tokens";
export const COST_LABEL = "Est. cost";
export const FARM_LABEL = "Build farm";
export const WALL_CLOCK_LABEL = "Wall clock";

/**
 * A token count as the card prints it — `212k`, `1.2M`, `850`.
 *
 * {@link compactNumber}'s one decimal, with a whole `.0` dropped, because the mockup writes
 * `212k / 400k` and a budget is a round number people typed.
 *
 * @param count The count.
 * @returns The figure.
 */
export function tokenFigure(count: number): string {
  return compactNumber(count).replace(/\.0(?=[kMBT]$)/, "");
}

/** One meter row: the figure on the right, and the bar under it when there is a denominator. */
export interface MeterRowView {
  readonly figure: string;
  /** A qualifier under the figure — the lower-bound note — or `null`. */
  readonly note: string | null;
  /** How full, `0`–`1`, or `null` for no meter at all. */
  readonly fraction: number | null;
  readonly tone: MeterTone;
}

/**
 * A fraction of a limit, safe at zero.
 *
 * @param used What was used.
 * @param limit The limit. `0` is a real instruction — *use nothing* — so anything used is full.
 * @returns The fraction, capped at `1`.
 */
function fractionOf(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 1 : 0;

  return Math.min(1, Math.max(0, used / limit));
}

/**
 * The *Tokens* row.
 *
 * @param tokens The payload.
 * @returns `212k / 400k budget` over a meter, or `212k tokens` alone when no model stage has
 *   pinned a budget — a meter needs a denominator, and there is none to invent.
 */
export function tokensRow(tokens: RunResources["tokens"]): MeterRowView {
  if (tokens.budget === null) {
    return { figure: `${tokenFigure(tokens.used)} tokens`, note: null, fraction: null, tone: "accent" };
  }

  const fraction = fractionOf(tokens.used, tokens.budget);

  return {
    figure: `${tokenFigure(tokens.used)} / ${tokenFigure(tokens.budget)} budget`,
    note: null,
    fraction,
    tone: meterTone(fraction),
  };
}

/**
 * The note beside a priced cost some of whose calls were not priced.
 *
 * @param events How many ledger rows carry no price.
 * @returns `lower bound — 3 calls unpriced`.
 */
export function lowerBoundNote(events: number): string {
  return `lower bound — ${counted(events, "call")} unpriced`;
}

/**
 * The ledger's cents, read.
 *
 * @param cents The decimal string (`"114.0000"`), or `null`.
 * @returns The number, or `null` for none or for a string that is not one — never `0`.
 */
function centsOf(cents: string | null): number | null {
  if (cents === null) return null;

  const value = Number.parseFloat(cents);

  return Number.isFinite(value) ? value : null;
}

/**
 * The *Est. cost* row.
 *
 * @param cost The payload.
 * @param tokens The token row's payload — what an unpriced cost prints instead of money.
 * @returns `$1.14 / $2.50 cap` over a meter; `$1.14` alone with no cap; and — **never `$0`** —
 *   `— · 212k tokens` when nothing attributed to the run is priced.
 */
export function costRow(cost: RunResources["cost"], tokens: RunResources["tokens"]): MeterRowView {
  const cents = centsOf(cost.costCents);

  if (cents === null) {
    return { figure: `${UNKNOWN} · ${tokenFigure(tokens.used)} tokens`, note: null, fraction: null, tone: "accent" };
  }

  const note = cost.unpricedEvents > 0 ? lowerBoundNote(cost.unpricedEvents) : null;

  if (cost.capCents === null) return { figure: moneyOfCents(cents), note, fraction: null, tone: "accent" };

  const fraction = fractionOf(cents, cost.capCents);

  return {
    figure: `${moneyOfCents(cents)} / ${moneyOfCents(cost.capCents)} cap`,
    note,
    fraction,
    tone: meterTone(fraction),
  };
}

/** What each farm job state says after the runner's name — the mockup's *reserved*. */
export const FARM_STATE: Readonly<Record<RunFarm["jobStatus"], string>> = {
  queued: "reserved",
  offered: "reserved",
  running: "building",
  succeeded: "built",
  failed: "build failed",
  retried: "retried",
  canceled: "released",
};

/** The dot beside the farm row — which state class it takes. */
export type FarmDot = "idle" | "live" | "ok" | "warn" | "err";

/** Each job state's dot: grey while held, lit while building. */
export const FARM_DOT: Readonly<Record<RunFarm["jobStatus"], FarmDot>> = {
  queued: "idle",
  offered: "idle",
  running: "live",
  succeeded: "ok",
  failed: "err",
  retried: "warn",
  canceled: "idle",
};

/** The *Build farm* row. */
export interface FarmRowView {
  /** `forge-02 reserved`, or `job #12 reserved` before a runner has taken it. */
  readonly figure: string;
  readonly dot: FarmDot;
}

/**
 * The *Build farm* row.
 *
 * @param farm The reservation, or `undefined` when the run holds none.
 * @returns The row, or `null` — **omitted entirely**, never a row naming a runner nobody held.
 */
export function farmRow(farm: RunFarm | undefined): FarmRowView | null {
  if (farm === undefined) return null;

  const holder = farm.runnerName ?? `job #${farm.jobNumber}`;

  return { figure: `${holder} ${FARM_STATE[farm.jobStatus]}`, dot: FARM_DOT[farm.jobStatus] };
}

/** *Resources*, ready to draw. The wall clock is the head's anchored elapsed, drawn by the card. */
export interface ResourcesView {
  readonly tokens: MeterRowView;
  readonly cost: MeterRowView;
  readonly farm: FarmRowView | null;
}

/**
 * *Resources*.
 *
 * @param resources The payload.
 * @returns The card's rows.
 */
export function resourcesView(resources: RunResources): ResourcesView {
  return {
    tokens: tokensRow(resources.tokens),
    cost: costRow(resources.cost, resources.tokens),
    farm: farmRow(resources.farm),
  };
}

// ---------------------------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------------------------

/** The card's title. */
export const GUARDRAILS_TITLE = "Guardrails";

/** What the card says before any check has answered. */
export const NO_VERDICTS = "No guardrail has been evaluated for this run yet.";

/** The evidence disclosure's summary. */
export const EVIDENCE_LABEL = "Evidence";

/** The header pill. */
export interface PillView {
  readonly label: string;
  readonly tone: ChipTone;
  readonly dot: ChipDot;
}

/**
 * The header pill, **computed from the verdicts on the card** — the service's own rule
 * (`RunGuardrails.status`), applied to the rows this card draws so the two cannot disagree:
 * any `fail` is `violations`; else any `pending` is `pending`; else, with at least one
 * verdict, `clean`; and no verdicts at all is `not evaluated`, which is not the same as clean.
 *
 * @param checks The verdicts.
 * @returns The pill.
 */
export function guardrailPill(checks: readonly RunGuardrailCheck[]): PillView {
  if (checks.some((check) => check.verdict === "fail")) return { label: "violations", tone: "err", dot: "filled" };
  if (checks.some((check) => check.verdict === "pending")) return { label: "pending", tone: "warn", dot: "ring" };
  if (checks.length === 0) return { label: "not evaluated", tone: "neutral", dot: "ring" };

  return { label: "clean", tone: "ok", dot: "filled" };
}

/** A verdict's mark and dot — the mockup's `✓` ok, `○` idle, and the two it does not draw. */
export type MarkTone = "ok" | "err" | "idle" | "warn";

/** Each verdict's mark. */
export const MARK: Readonly<Record<RunGuardrailCheck["verdict"], { glyph: string; tone: MarkTone; word: string }>> = {
  pass: { glyph: "✓", tone: "ok", word: "passed" },
  fail: { glyph: "✗", tone: "err", word: "failed" },
  not_applicable: { glyph: "○", tone: "idle", word: "not applicable" },
  pending: { glyph: "…", tone: "warn", word: "evaluating" },
};

/** What a row says, and the faint caption after it — per check, per verdict. */
type RowText = Readonly<{ text: string; caption: string | null }>;

/** Each check's sentence for each verdict. A `○` never reads as a pass. */
export const CHECK_TEXT: Readonly<
  Record<RunGuardrailCheck["check"], Readonly<Record<RunGuardrailCheck["verdict"], RowText>>>
> = {
  allowed_paths: {
    pass: { text: "Diff confined to allowed paths", caption: null },
    fail: { text: "Diff outside allowed paths", caption: null },
    not_applicable: { text: "Allowed paths not checked", caption: "(no plan declares a scope)" },
    pending: { text: "Allowed paths", caption: "(evaluating)" },
  },
  ci_config: {
    pass: { text: "No CI config touched", caption: null },
    fail: { text: "CI config touched", caption: null },
    not_applicable: { text: "CI config not checked", caption: null },
    pending: { text: "CI config", caption: "(evaluating)" },
  },
  secrets: {
    pass: { text: "Secrets scan clean", caption: null },
    fail: { text: "Possible secret in the diff", caption: null },
    not_applicable: { text: "Secrets not scanned", caption: null },
    pending: { text: "Secrets scan", caption: "(evaluating)" },
  },
  review_required: {
    pass: { text: "Human review required", caption: "(routes to a person)" },
    fail: { text: "Human review required", caption: "(auto-merge not permitted)" },
    not_applicable: { text: "Human review not required", caption: "(auto-merge eligible)" },
    pending: { text: "Review policy", caption: "(evaluating)" },
  },
};

/** One line of evidence — `Path drivers/can/a.c:42`. */
export interface EvidenceLine {
  readonly term: string;
  readonly value: string;
  /** Whether the value is a path, a rule id or a glob — drawn mono. */
  readonly mono: boolean;
}

/**
 * A verdict's evidence, as lines — where, and by which rule; never what (decision R5).
 *
 * @param evidence The evidence, or `undefined` when the verdict carries none.
 * @returns The lines, in the order a reader asks: where, which rule, which scope, why.
 */
export function evidenceLines(evidence: RunGuardrailCheck["evidence"]): readonly EvidenceLine[] {
  if (evidence === undefined) return [];

  const lines: EvidenceLine[] = [];

  if (evidence.path !== undefined) {
    const at = evidence.line === undefined ? evidence.path : `${evidence.path}:${evidence.line}`;
    lines.push({ term: "Path", value: at, mono: true });
  }
  if (evidence.rule_id !== undefined) lines.push({ term: "Rule", value: evidence.rule_id, mono: true });
  if (evidence.glob !== undefined) lines.push({ term: "Glob", value: evidence.glob, mono: true });
  if (evidence.detail !== undefined) lines.push({ term: "Detail", value: evidence.detail, mono: false });

  return lines;
}

/** One verdict row. */
export interface GuardrailRowView {
  readonly key: string;
  readonly glyph: string;
  readonly tone: MarkTone;
  readonly text: string;
  readonly caption: string | null;
  /** What a screen reader hears — `Secrets scan clean: passed`. */
  readonly accessibleName: string;
  readonly evidence: readonly EvidenceLine[];
  /** Whether the evidence starts open — a failure's always does. */
  readonly expanded: boolean;
  /** The secrets ruleset's disclosure, on the secrets row only; `null` elsewhere. */
  readonly disclosure: string | null;
}

/** *Guardrails*, ready to draw. */
export interface GuardrailsView {
  readonly pill: PillView;
  readonly rows: readonly GuardrailRowView[];
  /** `Policy: standard-fix v14 · tenant acme-robotics`. */
  readonly policy: string;
}

/**
 * What the secrets tooltip says: the ruleset, and what a pass does not mean.
 *
 * @param secrets AP.3's disclosure.
 * @returns The two sentences, or `null` when the service stated neither.
 */
export function secretsDisclosure(secrets: RunGuardrails["secrets"]): string | null {
  const text = [secrets.summary, secrets.limitation].map((part) => part.trim()).filter(Boolean).join(" ");

  return text === "" ? null : text;
}

/**
 * *Guardrails*.
 *
 * @param guardrails The payload.
 * @returns The card: the computed pill, one row per verdict in the payload's order, the footer.
 */
export function guardrailsView(guardrails: RunGuardrails): GuardrailsView {
  const disclosure = secretsDisclosure(guardrails.secrets);
  const { workflowTag, workflowVersion, tenant } = guardrails.policy;

  return {
    pill: guardrailPill(guardrails.checks),
    rows: guardrails.checks.map((check) => {
      const mark = MARK[check.verdict];
      const { text, caption } = CHECK_TEXT[check.check][check.verdict];

      return {
        key: check.check,
        glyph: mark.glyph,
        tone: mark.tone,
        text,
        caption,
        accessibleName: `${text}: ${mark.word}`,
        evidence: evidenceLines(check.evidence),
        expanded: check.verdict === "fail",
        disclosure: check.check === "secrets" ? disclosure : null,
      };
    }),
    policy: `Policy: ${workflowCaption(workflowTag, workflowVersion)} · tenant ${tenant}`,
  };
}
