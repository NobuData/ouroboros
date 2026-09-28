/**
 * The seven gate providers — each reduces one evidence system to a verdict and one mono line.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)). Every provider is a pure function
 * of {@link GateFacts}, so identical inputs always produce an identical verdict and evidence line —
 * the idempotency the gates card depends on. None of them throws for missing evidence: absence is
 * `pending` (the evidence will come) or `not_required` (it does not apply).
 *
 * ```
 * gate             green line                                          ref
 * build            forge-01 · zephyr.elf · FLASH 43.5%                   build_job
 * test_suite       63/63 after attempt 4                                 test_run
 * physical_hil     overshoot 1.7% ≤ 2.0% · rig helios-rig-02             hil_measurement
 * diff_vs_plan     all hunks map to planned files · 0 out-of-scope edits —
 * secrets_license  clean (headers + manifest delta)                      guardrail_evaluation
 * human_approval   not required by policy · approved by Ken              approval (a slot, AX.5)
 * model_review     unavailable — arrives with the provider stack         —   (never pending: AZ.1, #371)
 * ```
 *
 * The line is what makes a red gate actionable, so a red line always says what was measured,
 * against what and where — `overshoot 2.4% > 2.0% · rig helios-rig-02`, `2 out-of-scope edits:
 * …` — never only `failed`.
 */

import { GlobSet, widenToScope } from "../../guardrails/guardrails.glob";
import { describeFinding, scanLicenses } from "./gate.license";
import { SPDX_LIST_VERSION } from "./gate.spdx";
import type { GateOutcome, GateProvider, HilFact } from "./gate.types";
import { figureWithUnit, metricLabel, sharedScale } from "../hil.format";

/** The provider build every built-in gate reports. Bump when a verdict rule or a line changes. */
export const GATE_PROVIDER_RELEASE = "1.0.0";

/** The longest evidence line V056 stores. */
export const MAX_EVIDENCE = 512;

/** The line `model_review` reports until a provider exists. */
export const MODEL_REVIEW_UNAVAILABLE = "unavailable — arrives with the provider stack";

/**
 * Bound a line to V056's 512 characters, ending with an ellipsis when cut.
 *
 * @param line - The composed line.
 * @returns It, or its first 511 characters and `…`.
 */
export function boundEvidence(line: string): string {
  const trimmed = line.trim();

  return trimmed.length <= MAX_EVIDENCE ? trimmed : `${trimmed.slice(0, MAX_EVIDENCE - 1)}…`;
}

/**
 * Whether two shas name the same commit — one may be an abbreviation of the other.
 *
 * @param a - A sha.
 * @param b - Another.
 * @returns `true` when the shorter is a prefix of the longer.
 */
export function sameCommit(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];

  return short.length >= 7 && long.toLowerCase().startsWith(short.toLowerCase());
}

/**
 * @param count - How many.
 * @param noun - The singular.
 * @returns `1 case`, `3 cases`.
 */
function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * @param head - A revision head.
 * @returns Its seven-character chip.
 */
function short(head: string): string {
  return head.slice(0, 7);
}

/** `FLASH:  912344 B  2 MB  43.50%` — the memory map's flash row. */
const FLASH_ROW = /FLASH:[^\n]*?(\d+(?:\.\d+)?)%/g;
/** `Linking zephyr.elf`, `Linking C executable zephyr/zephyr.elf`. */
const LINK_LINE = /Linking(?: [A-Za-z+]+ executable)? (\S+)/g;

/**
 * The last match of a global pattern's first group.
 *
 * @param pattern - A global pattern.
 * @param text - Where to look.
 * @returns The group of the last match, or undefined.
 */
function lastMatch(pattern: RegExp, text: string): string | undefined {
  return [...text.matchAll(pattern)].at(-1)?.[1];
}

/**
 * A `numeric` rendered without trailing zeros past the point — `43.50` → `43.5`, `43.00` → `43`.
 *
 * @param value - The digits.
 * @returns The trimmed digits.
 */
function trimScale(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

/** `build` — the latest farm build of the revision's head. */
export const buildProvider: GateProvider = {
  key: "build",
  version: `gate-build@${GATE_PROVIDER_RELEASE}`,
  evaluate({ build, revision }): GateOutcome {
    if (build === null) {
      return {
        verdict: "pending",
        evidence: `no build of ${short(revision.headSha)} yet`,
        evidenceRef: null,
      };
    }

    const ref = { kind: "build_job" as const, id: build.jobId };
    const runner = build.runnerName ?? "unassigned";

    if (build.status === "succeeded") {
      const artifact = lastMatch(LINK_LINE, build.logTail)?.split("/").at(-1);
      const flash = lastMatch(FLASH_ROW, build.logTail);
      const parts = [
        runner,
        artifact,
        flash === undefined ? undefined : `FLASH ${trimScale(flash)}%`,
      ];

      return {
        verdict: "green",
        evidence: parts.filter((part) => part !== undefined).join(" · "),
        evidenceRef: ref,
      };
    }

    if (build.status === "failed" || build.status === "canceled") {
      const why =
        build.status === "canceled" ? "canceled" : `exit ${String(build.exitCode ?? "unknown")}`;

      return { verdict: "red", evidence: `${runner} · ${why}`, evidenceRef: ref };
    }

    return { verdict: "pending", evidence: `${runner} · ${build.status}`, evidenceRef: ref };
  },
};

/** `test_suite` — the latest test attempt at the head, with AS.4 waivers. */
export const testSuiteProvider: GateProvider = {
  key: "test_suite",
  version: `gate-test_suite@${GATE_PROVIDER_RELEASE}`,
  evaluate({ attempt, revision, waivedCaseKeys }): GateOutcome {
    if (attempt === null) {
      return {
        verdict: "pending",
        evidence: `no test attempt at ${short(revision.headSha)} yet`,
        evidenceRef: null,
      };
    }

    const ref = { kind: "test_run" as const, id: attempt.id };
    const seq = String(attempt.attemptSeq);

    if (attempt.status === "running") {
      return { verdict: "pending", evidence: `attempt ${seq} running`, evidenceRef: ref };
    }

    if (attempt.status === "error") {
      return {
        verdict: "red",
        evidence: `attempt ${seq} errored before its results could be read`,
        evidenceRef: ref,
      };
    }

    if (attempt.total === 0) {
      // A finished attempt with no cases proved nothing — not a pass.
      return {
        verdict: "red",
        evidence: `attempt ${seq} reported no test cases`,
        evidenceRef: ref,
      };
    }

    const tally = `${String(attempt.passed)}/${String(attempt.total)}`;

    if (attempt.failed === 0) {
      return { verdict: "green", evidence: `${tally} after attempt ${seq}`, evidenceRef: ref };
    }

    const failing = attempt.failingCaseKeys;

    if (failing.length > 0 && failing.every((key) => waivedCaseKeys.has(key))) {
      return {
        verdict: "waived",
        evidence: `${counted(failing.length, "failing case")} waived · ${tally} after attempt ${seq}`,
        evidenceRef: ref,
      };
    }

    return {
      verdict: "red",
      evidence: `${tally} · ${String(attempt.failed)} failing after attempt ${seq}`,
      evidenceRef: ref,
    };
  },
};

/**
 * How far a measurement sits inside its limit, relative to the limit — negative when outside.
 *
 * A zero limit has no relative headroom (`0 ≤ 0` is the only passing value, not a near miss), so
 * it ranks after every measurement that has one.
 *
 * @param fact - The measurement.
 * @returns The relative headroom, or `Infinity` for a zero limit.
 */
function headroom(fact: HilFact): number {
  const value = Number(fact.value);
  const limit = Number(fact.limitValue);

  if (limit === 0) {
    return fact.verdict === "fail" ? -Infinity : Infinity;
  }

  const inside = fact.limitKind === "max" ? limit - value : value - limit;

  return inside / Math.abs(limit);
}

/**
 * The measurement the line reports: the worst failure when any failed, else the closest to its
 * limit. Ties break by id, so the choice is deterministic.
 *
 * @param facts - The measurements. Not empty.
 * @returns The one to report.
 */
function reported(facts: readonly HilFact[]): HilFact {
  const failing = facts.filter((fact) => fact.verdict === "fail");
  const pool = failing.length > 0 ? failing : facts;

  return [...pool].sort((a, b) => headroom(a) - headroom(b) || (a.id < b.id ? -1 : 1))[0];
}

/**
 * One measurement as the gate's line — `overshoot 1.7% ≤ 2.0% · rig helios-rig-02`.
 *
 * The value and the limit are written at the same scale, so a limit a parser stored as `2` reads
 * `2.0` beside a `2.4` — the comparison a reader makes is between like figures.
 *
 * @param fact - The measurement.
 * @returns The line: the metric without its unit suffix, the value and limit with the unit, the
 *   comparison `hil_verdict()` chose, and where it was measured.
 */
export function measurementLine(fact: HilFact): string {
  const metric = metricLabel(fact.metric);
  const scale = sharedScale(fact.value, fact.limitValue);
  const withUnit = (value: string): string => figureWithUnit(value, fact.unit, scale);
  const pass = fact.verdict === "pass";
  const sign = fact.limitKind === "max" ? (pass ? "≤" : ">") : pass ? "≥" : "<";
  const rig = /^rig:(.+)$/.exec(fact.platform);
  const where = rig === null ? fact.platform : `rig ${rig[1]}`;

  return `${metric} ${withUnit(fact.value)} ${sign} ${withUnit(fact.limitValue)} · ${where}`;
}

/** `physical_hil` — the attempt's physical measurements against their limits. */
export const physicalHilProvider: GateProvider = {
  key: "physical_hil",
  version: `gate-physical_hil@${GATE_PROVIDER_RELEASE}`,
  evaluate({ attempt, hil, revision, waivedCaseKeys }): GateOutcome {
    if (attempt === null) {
      return {
        verdict: "pending",
        evidence: `no test attempt at ${short(revision.headSha)} yet`,
        evidenceRef: null,
      };
    }

    if (hil.length === 0) {
      return attempt.status === "running"
        ? {
            verdict: "pending",
            evidence: `attempt ${String(attempt.attemptSeq)} running`,
            evidenceRef: null,
          }
        : {
            verdict: "not_required",
            evidence: `no physical suite in attempt ${String(attempt.attemptSeq)}`,
            evidenceRef: null,
          };
    }

    const fact = reported(hil);
    const ref = { kind: "hil_measurement" as const, id: fact.id };
    const line = measurementLine(fact);

    if (fact.verdict === "pass") {
      return { verdict: "green", evidence: line, evidenceRef: ref };
    }

    const failingKeys = hil.filter((each) => each.verdict === "fail").map((each) => each.caseKey);

    return failingKeys.every((key) => waivedCaseKeys.has(key))
      ? { verdict: "waived", evidence: `${line} · waived`, evidenceRef: ref }
      : { verdict: "red", evidence: line, evidenceRef: ref };
  },
};

/** `diff_vs_plan` — the revision's files inside the plan's declared scope. */
export const diffVsPlanProvider: GateProvider = {
  key: "diff_vs_plan",
  version: `gate-diff_vs_plan@${GATE_PROVIDER_RELEASE}`,
  evaluate({ planFiles, revision }): GateOutcome {
    // The same scope AP.3's allowed_paths judges against, so the two cannot disagree.
    const declared = widenToScope(planFiles ?? []);

    if (declared.length === 0) {
      return {
        verdict: "not_required",
        evidence: "no plan file list declares a scope",
        evidenceRef: null,
      };
    }

    const scope = new GlobSet(declared);
    const outside = revision.files
      .map((file) => file.path)
      .filter((path) => !scope.matches(path))
      .sort();

    if (outside.length === 0) {
      return {
        verdict: "green",
        evidence: "all hunks map to planned files · 0 out-of-scope edits",
        evidenceRef: null,
      };
    }

    return {
      verdict: "red",
      evidence: listWithin(`${counted(outside.length, "out-of-scope edit")}: `, outside),
      evidenceRef: null,
    };
  },
};

/**
 * A prefix and as many items as fit in {@link MAX_EVIDENCE}, then `+N more`.
 *
 * @param prefix - What the list follows.
 * @param items - The items, in order.
 * @returns The line, never over the bound.
 */
export function listWithin(prefix: string, items: readonly string[]): string {
  let line = prefix;

  for (const [index, item] of items.entries()) {
    const rest = items.length - index - 1;
    const candidate = `${line}${index === 0 ? "" : ", "}${item}`;
    const tail = rest === 0 ? "" : ` +${String(rest)} more`;

    if (candidate.length + tail.length > MAX_EVIDENCE) {
      return `${line} +${String(items.length - index)} more`;
    }
    line = candidate;
  }

  return line;
}

/** The scope a clean `secrets_license` line states — the layer's own claim, and no more. */
export const LICENSE_SCOPE = "headers + manifest delta";

/** `secrets_license` — AP.3's secrets verdict plus the V7 license layer. */
export const secretsLicenseProvider: GateProvider = {
  key: "secrets_license",
  version: `gate-secrets_license@${GATE_PROVIDER_RELEASE}+spdx@${SPDX_LIST_VERSION}`,
  evaluate({ secrets, revision, license }): GateOutcome {
    const ref = secrets === null ? null : { kind: "guardrail_evaluation" as const, id: secrets.id };
    const scan = scanLicenses(
      revision.diffExcerpt,
      revision.files.map((file) => file.path),
      license,
    );

    if (secrets?.verdict === "fail") {
      return {
        verdict: "red",
        evidence: "secrets: a known credential format in the added lines",
        evidenceRef: ref,
      };
    }

    if (scan.findings.length > 0) {
      const more = scan.findings.length - 1;

      return {
        verdict: "red",
        evidence: `license: ${describeFinding(scan.findings[0])}${more > 0 ? ` · +${String(more)} more` : ""}`,
        evidenceRef: ref,
      };
    }

    if (secrets?.verdict === "pending") {
      return { verdict: "pending", evidence: "secrets scan pending", evidenceRef: ref };
    }

    const scope = scan.checked
      ? LICENSE_SCOPE
      : "secrets only — no diff to check headers or manifest delta";
    const secretsNote = secrets === null ? " · no run secrets scan" : "";

    return { verdict: "green", evidence: `clean (${scope})${secretsNote}`, evidenceRef: ref };
  },
};

/**
 * `human_approval` — an approval slot's answer, else the policy's (AX.5,
 * [#361](https://github.com/NobuData/ouroboros/issues/361), decision **V5**).
 *
 * ```
 * newest slot            on this revision?   verdict        evidence
 * requested              —                   pending        review requested by Ken — awaiting approval
 * approved               yes                 green          approved by Ken — <note>
 * declined               yes                 red            declined by Ken — <note>
 * approved | declined    no (a later push)   pending        approved on an earlier revision — this one needs a fresh review
 * none                   —                   the policy's answer, below
 * ```
 *
 * A person asking for a review is what flips a policy's `not_required` to a question someone must
 * answer, so any slot takes precedence over the policy. Without one, a person must approve when the
 * pinned terminal does not auto-merge. Routing's `add_vote` rules ask for a second *model*, which
 * is `model_review`'s question, not this one — so a vote rule leaves an auto-merging policy's human
 * approval `not_required`, as mockup 12's Revision 2 reads.
 */
export const humanApprovalProvider: GateProvider = {
  key: "human_approval",
  version: `gate-human_approval@${GATE_PROVIDER_RELEASE}`,
  evaluate({ review, approval, revision }): GateOutcome {
    if (approval !== null) {
      const evidenceRef = { kind: "approval", id: approval.id } as const;

      if (approval.state === "requested") {
        const by = approval.requestedBy === null ? "" : ` by ${approval.requestedBy}`;

        return {
          verdict: "pending",
          evidence: `review requested${by} — awaiting approval`,
          evidenceRef,
        };
      }

      if (approval.decidedRevisionId !== revision.id) {
        return {
          verdict: "pending",
          evidence: `${approval.state} on an earlier revision — this one needs a fresh review`,
          evidenceRef,
        };
      }

      const who = approval.decidedBy ?? "a former member";
      const note = approval.note === null ? "" : ` — ${approval.note}`;

      return {
        verdict: approval.state === "approved" ? "green" : "red",
        evidence: `${approval.state} by ${who}${note}`,
        evidenceRef,
      };
    }

    if (review?.autoMerges === true) {
      return { verdict: "not_required", evidence: "not required by policy", evidenceRef: null };
    }

    const why =
      review === undefined
        ? "no readable workflow policy"
        : "the terminal policy routes this PR to a person";

    return { verdict: "pending", evidence: `awaiting human approval — ${why}`, evidenceRef: null };
  },
};

/**
 * `model_review` — the contract slot. No second-model provider exists until AZ.1 (#371), so a
 * required review is `unavailable`, never `pending`: `pending` would claim a review is running.
 */
export const modelReviewProvider: GateProvider = {
  key: "model_review",
  version: `gate-model_review@${GATE_PROVIDER_RELEASE}`,
  evaluate({ voteRules }): GateOutcome {
    return voteRules === 0
      ? {
          verdict: "not_required",
          evidence: "no vote rule asks for a second model",
          evidenceRef: null,
        }
      : { verdict: "unavailable", evidence: MODEL_REVIEW_UNAVAILABLE, evidenceRef: null };
  },
};

/** The registry — a gate key without an entry here is `unavailable`. */
export const GATE_PROVIDERS: ReadonlyMap<string, GateProvider> = new Map(
  [
    buildProvider,
    testSuiteProvider,
    physicalHilProvider,
    diffVsPlanProvider,
    secretsLicenseProvider,
    humanApprovalProvider,
    modelReviewProvider,
  ].map((provider) => [provider.key, provider]),
);
