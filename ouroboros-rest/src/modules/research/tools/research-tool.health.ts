/**
 * What the research tools card draws from a tool — its health dot and its sub-line.
 *
 * CL.1 ([#614](https://github.com/NobuData/ouroboros/issues/614)). Mockup 22's card has four dot
 * colours in the shared stylesheet — `.dot.ok`, `.dot.warn`, `.dot.err` and `.dot.idle` — and
 * the acceptance criterion is that a tool's health maps onto them **one to one**. So there are
 * exactly four states, each owning one dot, and the idle one is its own state rather than a
 * failure: *Docs, standards & papers* is not broken, it is not configured, and the card draws it
 * with an **enable** button instead of an alarm.
 */

/** A tool's health, as the card shows it. */
export const TOOL_HEALTH_STATES = ["healthy", "degraded", "down", "not_configured"] as const;

/** One of {@link TOOL_HEALTH_STATES}. */
export type ToolHealthState = (typeof TOOL_HEALTH_STATES)[number];

/** The card's dot classes — `.dot.<class>` in the shared stylesheet. */
export type ToolHealthDot = "ok" | "warn" | "err" | "idle";

/**
 * Each state's dot. Total and injective: every state has a dot and no two share one, which
 * `research-tool.health.spec.ts` asserts.
 */
export const TOOL_HEALTH_DOTS: Readonly<Record<ToolHealthState, ToolHealthDot>> = {
  healthy: "ok",
  degraded: "warn",
  down: "err",
  not_configured: "idle",
};

/** What `healthCheck()` answers. */
export interface ToolHealth {
  /** The state — and so the dot. */
  readonly state: ToolHealthState;
  /**
   * A short note for the dot's tooltip — `200 · 41ms`, `key rejected (401)`, `not configured`.
   * Never empty, and never the credential.
   */
  readonly detail: string;
}

/** The health of a tool the workspace has not configured — the idle dot, with no network call. */
export const NOT_CONFIGURED_HEALTH: ToolHealth = {
  state: "not_configured",
  detail: "not configured",
};

/**
 * The dot a health result renders as.
 *
 * @param health - What `healthCheck()` answered.
 * @returns The dot class.
 */
export function healthDot(health: ToolHealth): ToolHealthDot {
  return TOOL_HEALTH_DOTS[health.state];
}

/** A `{slot}` in a sub-line template: a lowercase name. */
const SLOT = /\{([a-z][a-z0-9_]*)\}/g;

/** What an unknown count renders as. */
export const UNKNOWN_COUNT = "—";

/**
 * The slots a sub-line template names, in order of first appearance.
 *
 * @param template - `{rivals} rivals watched · release notes, changelogs, filings`.
 * @returns `["rivals"]`; empty for a template with nothing to count.
 */
export function subLineSlots(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT)].map((match) => match[1]))];
}

/**
 * The sub-line, its slots filled from live counts.
 *
 * @param template - The tool's {@link import("./research-tool.adapter").ToolDisplayMeta.subLine}.
 * @param counts - What `counts()` answered. A null — or missing — count renders as an em dash
 *   rather than as zero: an unknown count and an empty registry are different facts.
 * @returns `4 rivals watched · release notes, changelogs, filings`; `3,412 issues · …`.
 */
export function renderSubLine(
  template: string,
  counts: Readonly<Record<string, number | null>>,
): string {
  return template.replaceAll(SLOT, (_match, slot: string) => {
    const count = counts[slot];

    return typeof count === "number" ? count.toLocaleString("en-US") : UNKNOWN_COUNT;
  });
}
