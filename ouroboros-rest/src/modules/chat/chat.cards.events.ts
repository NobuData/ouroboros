/**
 * Event cards (BZ.2, [#536](https://github.com/NobuData/ouroboros/issues/536)) — pure.
 *
 * One composer per family `chat_messages` admits: a loop that finished, a build that went green,
 * a build that failed, and the weekly digest. Each takes **facts** — counts, instants, ids — and
 * says them in the mockup's shape; none takes a sentence somebody else wrote.
 *
 * **A figure that does not exist is not printed.** The stats line reads
 * `14/14 checks · 11m cycle · $0.94 · claude-fable-5`, and every part of it is optional: no
 * check counts, no part; a run that was not fully priced, no cost — not `$0.00`, and not the
 * lower bound a partly priced run would give; no model on record, no model. A line with nothing
 * in it is not drawn at all.
 */

import {
  DIGEST_TITLE,
  OPEN_INSIGHTS,
  PROXY_MARK,
  deltaNote,
  windowText,
} from "../insights/digest/digest.copy";
import type { DigestAssembly } from "../insights/digest/digest.assembly";
import { insightsUrl } from "../insights/digest/digest.render";
import { shortDuration, statsLine, type ChatCard, type ChatCardAction } from "./chat.card";

/** The marks of the four families. */
export const EVENT_MARKS = {
  loop_finished: "✓",
  build_green: "⟳",
  build_failed: "✕",
  digest: "✦",
} as const;

/**
 * An origin with no trailing slash.
 *
 * @param uiUrl - `OURO_UI_URL`.
 * @returns It, ready to take a path.
 */
function origin(uiUrl: string): string {
  return uiUrl.replace(/\/+$/, "");
}

/**
 * A cost as the stats line prints it — or nothing.
 *
 * @param cost - The run's spend: its cost in cents (null when nothing was priced) and how many
 *   of its usage events had no price.
 * @returns `$0.94` only when every event was priced; otherwise null.
 */
export function pricedCost(cost: {
  costCents: string | number | null;
  unpricedEvents: number;
}): string | null {
  if (cost.costCents === null || cost.unpricedEvents > 0) {
    return null;
  }

  const cents = Number(cost.costCents);

  return Number.isFinite(cents) && cents >= 0 ? `$${(cents / 100).toFixed(2)}` : null;
}

/** What a finished loop's card is composed from. */
export interface LoopFinishedFacts {
  readonly runId: string;
  readonly loopSeq: number;
  readonly issueNumber: number | null;
  readonly issueTitle: string | null;
  /** The merged pull request's number, and its id here when it is mirrored. */
  readonly prNumber: number | null;
  readonly prId: string | null;
  readonly checksPassed: number | null;
  readonly checksTotal: number | null;
  /** Started to finished, in seconds — null when either instant is missing. */
  readonly cycleSeconds: number | null;
  readonly costCents: string | number | null;
  readonly unpricedEvents: number;
  /** The model that ran, or null when none is on record. */
  readonly model: string | null;
}

/**
 * *Loop #1846 finished — PR #512 merged.*
 *
 * @param facts - The run.
 * @param uiUrl - The UI origin.
 * @returns The card.
 */
export function loopFinishedCard(facts: LoopFinishedFacts, uiUrl: string): ChatCard {
  const actions: ChatCardAction[] = [];

  if (facts.prId !== null) {
    actions.push({
      type: "link",
      id: "view_pr",
      label: "View PR ↗",
      url: `${origin(uiUrl)}/prs/${encodeURIComponent(facts.prId)}`,
    });
  }

  actions.push({
    type: "link",
    id: "run_console",
    label: "Run console",
    url: `${origin(uiUrl)}/runs/${encodeURIComponent(facts.runId)}`,
  });

  const issue =
    facts.issueNumber === null
      ? facts.issueTitle
      : `#${String(facts.issueNumber)}${facts.issueTitle === null ? "" : ` ${facts.issueTitle}`}`;

  return {
    kind: "card",
    severity: "ok",
    mark: EVENT_MARKS.loop_finished,
    headline:
      `Loop #${String(facts.loopSeq)} finished` +
      (facts.prNumber === null ? "" : ` — PR #${String(facts.prNumber)} merged`),
    lines: issue === null ? [] : [issue],
    stats: statsLine([
      facts.checksPassed === null || facts.checksTotal === null
        ? null
        : `${String(facts.checksPassed)}/${String(facts.checksTotal)} checks`,
      facts.cycleSeconds === null ? null : `${shortDuration(facts.cycleSeconds)} cycle`,
      pricedCost(facts),
      facts.model,
    ]),
    actions,
    footnote: null,
  };
}

/** What a build card is composed from. */
export interface BuildFacts {
  readonly runId: string;
  readonly loopSeq: number;
  /** Which build of the loop this was, when the source counts them. */
  readonly buildNumber: number | null;
  readonly passed: number;
  readonly total: number;
  readonly prNumber: number | null;
  readonly prId: string | null;
  /** The PR revision being published, when there is one. */
  readonly revision: number | null;
}

/**
 * `Loop #1847 build 3`, or `Loop #1847 build` when builds are not numbered.
 *
 * @param facts - The build.
 * @returns The subject of a build headline.
 */
function buildSubject(facts: BuildFacts): string {
  return `Loop #${String(facts.loopSeq)} build${facts.buildNumber === null ? "" : ` ${String(facts.buildNumber)}`}`;
}

/**
 * *Loop #1847 build 3 green — 63/63 · publishing PR #514 rev 2.*
 *
 * @param facts - The build.
 * @param uiUrl - The UI origin.
 * @returns The card.
 */
export function buildGreenCard(facts: BuildFacts, uiUrl: string): ChatCard {
  const publishing =
    facts.prNumber === null
      ? ""
      : ` · publishing PR #${String(facts.prNumber)}${facts.revision === null ? "" : ` rev ${String(facts.revision)}`}`;

  return {
    kind: "card",
    severity: "accent",
    mark: EVENT_MARKS.build_green,
    headline: `${buildSubject(facts)} green — ${String(facts.passed)}/${String(facts.total)}${publishing}`,
    lines: [],
    stats: null,
    actions:
      facts.prId === null
        ? [
            {
              type: "link",
              id: "run_console",
              label: "Run console",
              url: `${origin(uiUrl)}/runs/${encodeURIComponent(facts.runId)}`,
            },
          ]
        : [
            {
              type: "link",
              id: "pr_verification",
              label: "PR verification →",
              url: `${origin(uiUrl)}/prs/${encodeURIComponent(facts.prId)}`,
            },
          ],
    footnote: null,
  };
}

/**
 * *Loop #1847 build 3 failed — 2 of 63 failing.*
 *
 * @param facts - The build.
 * @param uiUrl - The UI origin.
 * @returns The card.
 */
export function buildFailedCard(facts: BuildFacts, uiUrl: string): ChatCard {
  const failing = Math.max(0, facts.total - facts.passed);

  return {
    kind: "card",
    severity: "err",
    mark: EVENT_MARKS.build_failed,
    headline: `${buildSubject(facts)} failed — ${String(failing)} of ${String(facts.total)} failing`,
    lines: [],
    stats: null,
    actions: [
      {
        type: "link",
        id: "run_console",
        label: "Run console",
        url: `${origin(uiUrl)}/runs/${encodeURIComponent(facts.runId)}`,
      },
    ],
    footnote: null,
  };
}

/**
 * The weekly digest, for a channel — the same assembly the mail renders (#440), so the two
 * cannot disagree about a figure.
 *
 * @param assembly - The week.
 * @param uiUrl - The UI origin.
 * @returns The card. An empty week says so in its headline and prints no figures.
 */
export function digestCard(assembly: DigestAssembly, uiUrl: string): ChatCard {
  const lines: string[] = [];

  if (!assembly.empty) {
    for (const kpi of assembly.kpis) {
      const note = deltaNote(kpi);

      // A proxy figure says so here too, as it does in the mail.
      const label = kpi.proxy ? `${kpi.label} (${PROXY_MARK})` : kpi.label;

      lines.push(`${label}: ${kpi.valueText}${note === "" ? "" : ` (${note})`}`);
    }

    if (assembly.topCause !== null) {
      lines.push(assembly.topCause.text);
    }

    for (const mover of assembly.flaky) {
      lines.push(`${mover.name} (${mover.repository}) — ${mover.text}`);
    }
  }

  return {
    kind: "card",
    severity: "info",
    mark: EVENT_MARKS.digest,
    headline: `${DIGEST_TITLE} — ${assembly.headline}`,
    lines,
    // The assembly's own cost sentence: it already says *unpriced* rather than a number.
    stats: assembly.empty ? null : assembly.cost.text,
    actions: [{ type: "link", id: "open_insights", label: OPEN_INSIGHTS, url: insightsUrl(uiUrl) }],
    footnote: windowText(assembly.window),
  };
}
