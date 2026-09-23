/**
 * Mockup 10's values, read out of `docs/mockups/10-run-detail.html` at test time.
 *
 * AP.6 ([#308](https://github.com/NobuData/ouroboros/issues/308)): *"Fixtures derive from the
 * mockup's values, so a drift from the design source is a test failure."* So nothing here is
 * typed in: every value is parsed from the page's own markup, the way W.2's Loop Checks suite
 * reads mockup 05 (`workflows/code.checks.spec.ts`). An edit to the mockup that the seed does
 * not follow — or a seed edit the mockup does not follow — fails
 * `console.mockup.integration-spec.ts`.
 *
 * Every reader throws when the markup no longer yields its value, rather than returning
 * `undefined`: a parser that quietly found nothing would turn a drift into a vacuous pass.
 *
 * Nothing here ships: `tsconfig.build.json` excludes `*.fixture.ts`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { GuardrailCheck, GuardrailVerdict } from "../db/schema";

/** Mockup 10, the Run Console's design source. */
export const MOCKUP_PATH = resolve(__dirname, "../../../../docs/mockups/10-run-detail.html");

/** One stepper node. */
export interface MockupStage {
  /** `done`, `active` or `pending` — the node's class, with no class meaning pending. */
  readonly state: "done" | "active" | "pending";
  /** The node's label — `Implement`. */
  readonly label: string;
  /** The caption under a finished node, in seconds — `1m 12s` is 72. */
  readonly durationSeconds?: number;
  /** The active node's `attempt 2/3`. */
  readonly attempt?: { readonly current: number; readonly max: number };
  /** The warn note under the node. */
  readonly note?: string;
}

/** One transcript entry's head. */
export interface MockupEntry {
  /** The chip, as an actor: `plan`, `tool`, `gate` — or `model` for a model id's chip. */
  readonly actor: "plan" | "tool" | "gate" | "model";
  /** The model id a `model` chip names, lower-cased the way the store holds it. */
  readonly modelId?: string;
  /** The tool tag beside a `tool` chip. */
  readonly toolTag?: string;
}

/** Everything the console page is asserted against. */
export interface MockupRun {
  readonly loopSeq: number;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly status: string;
  readonly workflowTag: string;
  readonly workflowVersion: number;
  readonly model: string;
  readonly elapsedSeconds: number;
  readonly branchName: string;
  readonly stages: readonly MockupStage[];
  readonly transcript: readonly MockupEntry[];
  readonly files: readonly { path: string; additions: number; deletions: number }[];
  readonly commits: readonly { shortSha: string; subject: string }[];
  /** `will squash on merge` → `squash`. */
  readonly mergeStrategy: string;
  /** `212k / 400k budget`, in tokens. */
  readonly tokens: { readonly used: number; readonly budget: number };
  /** `$1.14 / $2.50 cap`, in cents. */
  readonly cost: { readonly costCents: number; readonly capCents: number };
  /** `forge-02 reserved` → `forge-02`. */
  readonly farmRunner: string;
  /** The Guardrails card's pill — `clean`. */
  readonly guardrailStatus: string;
  /** The four rows, in the card's order, as the verdict each mark draws. */
  readonly guardrails: readonly { check: GuardrailCheck; verdict: GuardrailVerdict }[];
  /** `Policy: standard-fix v14 · tenant acme-robotics`. */
  readonly policy: {
    readonly workflowTag: string;
    readonly workflowVersion: number;
    readonly tenant: string;
  };
}

/**
 * The first capture of a pattern, or a thrown error naming what went missing.
 *
 * @param html - The mockup.
 * @param pattern - A pattern with at least one group.
 * @param what - What the value is, for the error.
 * @returns The match's groups, from 1.
 * @throws {Error} When the pattern no longer matches.
 */
function capture(html: string, pattern: RegExp, what: string): string[] {
  const match = pattern.exec(html);

  if (match === null) {
    throw new Error(`Mockup 10 no longer draws ${what} (${String(pattern)}).`);
  }

  return match.slice(1);
}

/**
 * Every match of a pattern, or a thrown error when there are none.
 *
 * @param html - The mockup.
 * @param pattern - A global pattern.
 * @param what - What the rows are, for the error.
 * @returns The matches, in document order.
 * @throws {Error} When nothing matches.
 */
function every(html: string, pattern: RegExp, what: string): RegExpMatchArray[] {
  const matches = [...html.matchAll(pattern)];

  if (matches.length === 0) {
    throw new Error(`Mockup 10 no longer draws any ${what} (${String(pattern)}).`);
  }

  return matches;
}

/**
 * `12m 40s` as seconds.
 *
 * @param text - A duration as the mockup writes one.
 * @returns The seconds.
 */
export function seconds(text: string): number {
  const [minutes, rest] = capture(text, /^(\d+)m (\d+)s$/, `a duration in "${text}"`);

  return Number(minutes) * 60 + Number(rest);
}

/**
 * `212k` as a count.
 *
 * @param text - A token count with an optional `k`.
 * @returns The count.
 */
function tokens(text: string): number {
  return text.endsWith("k") ? Number(text.slice(0, -1)) * 1000 : Number(text);
}

/**
 * `$1.14` as cents.
 *
 * @param text - A dollar amount.
 * @returns Whole cents.
 */
function cents(text: string): number {
  return Math.round(Number(text.replace("$", "")) * 100);
}

/** The Guardrails card's rows, in the order the mockup draws them. */
const GUARDRAIL_ROWS: readonly [string, GuardrailCheck][] = [
  ["Diff confined to allowed paths", "allowed_paths"],
  ["No CI config touched", "ci_config"],
  ["Secrets scan clean", "secrets"],
  ["Human review not required", "review_required"],
];

/** What each mark draws. */
const MARKS: Readonly<Record<string, GuardrailVerdict>> = {
  "✓": "pass",
  "✗": "fail",
  "○": "not_applicable",
};

/**
 * Parse mockup 10.
 *
 * @param html - The page's markup; the committed file when omitted.
 * @returns Every value the console page is asserted against.
 * @throws {Error} When any value can no longer be read.
 */
export function readMockup(html: string = readFileSync(MOCKUP_PATH, "utf8")): MockupRun {
  const [loopSeq] = capture(html, /class="eyebrow">Run Console · Loop #(\d+)</, "the loop number");
  const [issueNumber, issueTitle] = capture(html, /<h1>#(\d+) — (.*?)<\/h1>/, "the heading");
  const [status] = capture(
    html,
    /class="pill run"><span class="dot pulse"><\/span>(\w+)</,
    "the status pill",
  );
  const [workflowTag, workflowVersion] = capture(
    html,
    /<span class="tag">([\w-]+) v(\d+)<\/span>/,
    "the workflow tag",
  );
  const [model] = capture(html, /class="pill model">(.*?)</, "the model pill");
  const [elapsed] = capture(html, />elapsed (\d+m \d+s)</, "the elapsed time");
  const [branchName] = capture(html, />branch (.*?)</, "the branch");

  const stages = every(
    html,
    /<div class="step ?(done|active)?">[\s\S]*?class="s-name">(.*?)<\/span>(?:\s*<span class="s-cap">(.*?)<\/span>)?(?:\s*<span class="s-note">(.*?)<\/span>)?/g,
    "stepper nodes",
  ).map(([, state, label, caption, note]): MockupStage => {
    const attempt = caption === undefined ? null : /^attempt (\d+)\/(\d+)$/.exec(caption);

    return {
      state: (state as "done" | "active" | undefined) ?? "pending",
      label,
      ...(caption !== undefined && attempt === null ? { durationSeconds: seconds(caption) } : {}),
      ...(attempt === null
        ? {}
        : { attempt: { current: Number(attempt[1]), max: Number(attempt[2]) } }),
      ...(note === undefined ? {} : { note }),
    };
  });

  const transcript = every(
    html,
    /<span class="tr-actor (\w+)">(.*?)<\/span>(?:<span class="tag">(.*?)<\/span>)?/g,
    "transcript entries",
  ).map(([, kind, chip, tag]): MockupEntry => {
    if (kind === "model") {
      return { actor: "model", modelId: chip.toLowerCase() };
    }

    return {
      actor: kind as MockupEntry["actor"],
      ...(tag === undefined ? {} : { toolTag: tag }),
    };
  });

  const files = every(
    html,
    /<span class="path">(.*?)<\/span>\s*<span class="plus">\+(\d+)<\/span><span class="minus">−(\d+)<\/span>/g,
    "file rows",
  ).map(([, path, additions, deletions]) => ({
    path,
    additions: Number(additions),
    deletions: Number(deletions),
  }));

  const commits = every(
    html,
    /<span class="sha">(\w+)<\/span>\s*<span class="muted">(.*?)<\/span>/g,
    "commit rows",
  ).map(([, shortSha, subject]) => ({ shortSha, subject }));

  const [mergeStrategy] = capture(html, /class="tag">will (\w+) on merge</, "the merge tag");
  const [used, budget] = capture(
    html,
    /class="mono">(\d+k?) \/ (\d+k?) budget</,
    "the token meter",
  );
  const [cost, cap] = capture(html, /class="mono">(\$[\d.]+) \/ (\$[\d.]+) cap</, "the cost meter");
  const [farmRunner] = capture(html, /class="mono">([\w-]+) reserved</, "the farm reservation");
  const [guardrailStatus] = capture(
    html,
    /GUARDRAILS<\/span>[\s\S]*?class="pill \w+"><span class="dot \w+"><\/span>(\w+)</,
    "the guardrails pill",
  );

  const guardrails = GUARDRAIL_ROWS.map(([text, check]) => {
    const [mark] = capture(
      html,
      new RegExp(
        `<span class="mark \\w+">(.)</span><span class="dot \\w+"></span>\\s*<span>${text}`,
      ),
      `the "${text}" row`,
    );
    const verdict = MARKS[mark];

    if (verdict === undefined) {
      throw new Error(`Mockup 10 draws "${text}" with a mark nobody mapped: ${mark}`);
    }

    return { check, verdict };
  });

  const [policyTag, policyVersion, tenant] = capture(
    html,
    /Policy: ([\w-]+) v(\d+) · tenant ([\w-]+)</,
    "the policy footer",
  );

  return {
    loopSeq: Number(loopSeq),
    issueNumber: Number(issueNumber),
    issueTitle,
    status,
    workflowTag,
    workflowVersion: Number(workflowVersion),
    model,
    elapsedSeconds: seconds(elapsed),
    branchName,
    stages,
    transcript,
    files,
    commits,
    mergeStrategy,
    tokens: { used: tokens(used), budget: tokens(budget) },
    cost: { costCents: cents(cost), capCents: cents(cap) },
    farmRunner,
    guardrailStatus,
    guardrails,
    policy: { workflowTag: policyTag, workflowVersion: Number(policyVersion), tenant },
  };
}
