/**
 * The words both parts of the weekly Insights email share (#440) — subject, window, the note
 * beside a KPI, the footer.
 *
 * `digest.html.ts` and `digest.text.ts` differ in markup and in nothing else: a sentence that
 * appears in both is written here once, so the plain-text alternative cannot drift from the
 * HTML part one edit at a time.
 */

import type { Day } from "../rollup/rollup.types";
import type { DigestAssembly, DigestKpi } from "./digest.assembly";

/** Who and where a rendering is for. */
export interface DigestContext {
  /** The workspace's display name. */
  readonly workspaceName: string;
  /** Where *Open Insights* leads — the UI's page. */
  readonly insightsUrl: string;
  /**
   * This recipient's unsubscribe link. Null in a preview, which was sent to nobody and so has
   * nothing to unsubscribe from.
   */
  readonly unsubscribeUrl: string | null;
  /**
   * Why this recipient got the mail, when it is not a subscription — an org notification route
   * (#488) sends to an address that subscribed to nothing, so the subscription sentence would be
   * untrue. Absent for a subscriber's mail and a preview.
   */
  readonly reason?: string;
}

/** The mail's kicker. */
export const DIGEST_TITLE = "Weekly insights";

/** The KPI section's heading. */
export const KPI_HEADING = "This week against the week before";

/** The interventions section's heading — the page card's own title. */
export const CAUSE_HEADING = "Where loops needed a human";

/** The flaky section's heading. */
export const FLAKY_HEADING = "Flaky tests that moved";

/** The cost section's heading. */
export const COST_HEADING = "Cost";

/** The call to action's label. */
export const OPEN_INSIGHTS = "Open Insights";

/** What a proxy metric is marked with. */
export const PROXY_MARK = "proxy";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `Sep 25`.
 *
 * @param day - A UTC day.
 * @returns Month and day of month.
 */
function monthDay(day: Day): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${String(Number(day.slice(8, 10)))}`;
}

/**
 * The window as a mail prints it: `Sep 25 – Oct 1, 2026`.
 *
 * @param window - The assembly's window.
 * @returns The range, with the year of its last day.
 */
export function windowText(window: DigestAssembly["window"]): string {
  return `${monthDay(window.from)} – ${monthDay(window.to)}, ${window.to.slice(0, 4)}`;
}

/**
 * The subject line.
 *
 * @param assembly - The digest.
 * @param workspaceName - The workspace.
 * @returns `Weekly insights · Acme Robotics · Sep 25 – Oct 1, 2026`.
 */
export function digestSubject(assembly: DigestAssembly, workspaceName: string): string {
  return `${DIGEST_TITLE} · ${workspaceName} · ${windowText(assembly.window)}`;
}

/**
 * What stands beside a KPI's figure: how it moved, and whether that was the good way.
 *
 * The judgement is in words as well as colour, because the text part has no colour and an HTML
 * part read in a client that strips styles has none either.
 *
 * @param kpi - The KPI.
 * @returns `▲ 3pts vs prior week, better` — or why there is no move to state. Empty when the
 *   figure itself is unknown.
 */
export function deltaNote(kpi: DigestKpi): string {
  if (kpi.value === null) {
    return "";
  }

  if (kpi.delta === null) {
    return "no prior week to compare";
  }

  if (kpi.deltaText === null) {
    return "unchanged vs prior week";
  }

  const judgement = kpi.good === null ? "" : kpi.good ? ", better" : ", worse";

  return `${kpi.deltaText} vs prior week${judgement}`;
}

/**
 * What an empty digest says under its headline.
 *
 * @param context - The workspace.
 * @param assembly - The digest.
 * @returns The sentence.
 */
export function emptyNote(context: DigestContext, assembly: DigestAssembly): string {
  return (
    `No merges, interventions, builds, test runs or model usage were recorded for ` +
    `${context.workspaceName} between ${windowText(assembly.window)}.`
  );
}

/**
 * What the window line says: which days, and that the last one is not over.
 *
 * @param assembly - The digest.
 * @returns The sentence.
 */
export function windowNote(assembly: DigestAssembly): string {
  return (
    `${windowText(assembly.window)} · seven UTC days, the last one counted up to the time ` +
    `this was sent.`
  );
}

/**
 * Why the recipient got the mail.
 *
 * @param context - The workspace.
 * @returns The sentence.
 */
export function reasonNote(context: DigestContext): string {
  if (context.reason !== undefined) {
    return context.reason;
  }

  return context.unsubscribeUrl === null
    ? `This is a preview of the weekly Insights digest for ${context.workspaceName}. It was not sent to anyone.`
    : `You receive this because you subscribed to the weekly Insights digest for ${context.workspaceName}.`;
}

/** The sentence under the figures: where they come from. */
export const SOURCE_NOTE =
  "Every figure is the Insights page's own for the same seven days — nothing is computed for this email.";
