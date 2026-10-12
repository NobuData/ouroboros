/**
 * What mockup 20's Copilot page says for the seeded `security-patch`, and the reads beneath the
 * browser (leg 29, [#569](https://github.com/NobuData/ouroboros/issues/569)).
 *
 * The words are `ouroboros-ui`'s, copied on purpose — a leg that imported them would pass when
 * the product's copy and the product's behaviour drifted together. The reads are the service's:
 * the safety strip is asserted against **the payload the page was drawn from**, which is the
 * ticket's point — the three claims are derived, so the leg compares the page to the derivation
 * rather than to a list kept here.
 */

import type { BrowserContext } from "@playwright/test";

import { requestAs } from "./rest";

/* ------------------------------------------------------------------ the page */

/** The seeded workflow the copilot seed (`R__dev_seed_workspace_copilot.sql`) writes. */
export const SECURITY_PATCH = {
  id: "5eed0089-0000-4000-8000-000000000001",
  slug: "security-patch",
} as const;

/** The Copilot page on it. */
export const COPILOT_PATH = `/workflows/${SECURITY_PATCH.slug}/copilot`;

/** The page's `<h1>`, verbatim from mockup 20. */
export const COPILOT_TITLE =
  "Describe the workflow. Watch it build. Test it before it touches anything.";

/** The tab the segment marks current. */
export const COPILOT_TAB = "Copilot";

/** The four cards, by the element id each seat carries. */
export const SEATS = {
  conversation: "#copilot-conversation",
  stages: "#copilot-stages",
  dryRun: "#copilot-dry-run",
  safety: "#copilot-safety",
} as const;

/* ------------------------------------------------------------------ the safety strip */

/** The safety card's heading. */
export const SAFETY_TITLE = "Why dry runs are safe";

/** A column of the strip, as the service serves it. */
export interface SafetyColumn {
  readonly id: "simulated_writes" | "replayed_infra" | "real_models";
  readonly holds: boolean;
  readonly mechanism: {
    readonly kind: "overlay" | "estimator_service" | "gateway_routing";
    readonly tools: readonly string[];
    readonly path: string | null;
    readonly detail: string;
  };
}

/** `GET /api/v1/workflows/{id}/dry-runs/safety`. */
export interface Safety {
  readonly harness: string;
  readonly columns: readonly SafetyColumn[];
}

/** The three claims, verbatim from the issue — looked up by the id the payload sent. */
export const SAFETY_CLAIMS: Readonly<
  Record<SafetyColumn["id"], { readonly key: string; readonly sentence: string }>
> = {
  simulated_writes: {
    key: "Simulated writes",
    sentence: "Diffs are drafted in memory — the repo is untouched.",
  },
  replayed_infra: {
    key: "Replayed infra",
    sentence: "Build & test are estimated from your history; the farm stays idle.",
  },
  real_models: {
    key: "Real models",
    sentence: "Prompts & routing are exercised for real — that's what you're testing.",
  },
};

/** What each mechanism is called in its popover. */
export const MECHANISM_WORDS: Readonly<Record<SafetyColumn["mechanism"]["kind"], string>> = {
  overlay: "In-memory overlay",
  estimator_service: "Replay estimator service",
  gateway_routing: "Invocation gateway routing",
};

/**
 * The accessible name of a claim's ⓘ.
 *
 * @param key - The claim's key, *Simulated writes*.
 * @returns The button's name.
 */
export function mechanismButton(key: string): string {
  return `How “${key}” is enforced`;
}

/**
 * Read the safety strip as the service derives it.
 *
 * @param context - A signed-in context.
 * @returns The payload the page is drawn from.
 */
export async function readSafety(context: BrowserContext): Promise<Safety> {
  const safety = await requestAs<Safety>(
    context,
    "GET",
    `/api/v1/workflows/${SECURITY_PATCH.id}/dry-runs/safety`,
    null,
    "reading the dry run's safety strip",
  );
  if (safety === null) throw new Error("the safety strip answered with no body");

  return safety;
}

/* ------------------------------------------------------------------ readiness and the gateway */

/** `GET /api/v1/workflows/{id}/copilot/readiness`, as far as this leg reads it. */
export interface Readiness {
  readonly gateway: { readonly available: boolean };
  readonly route: { readonly resolved: boolean; readonly reason: string | null };
  readonly dryRun: { readonly id: string } | null;
}

/**
 * Read whether a message sent to the copilot now could be answered.
 *
 * @param context - A signed-in context.
 * @returns The service's readiness.
 */
export async function readReadiness(context: BrowserContext): Promise<Readiness> {
  const readiness = await requestAs<Readiness>(
    context,
    "GET",
    `/api/v1/workflows/${SECURITY_PATCH.id}/copilot/readiness`,
    null,
    "reading the copilot's readiness",
  );
  if (readiness === null) throw new Error("the copilot's readiness answered with no body");

  return readiness;
}

/** The gateway notice's title — the page's honest hard-prerequisite state (decision W1). */
export const GATEWAY_NOTICE_TITLE = "The copilot needs the invocation gateway";

/** Why the composer cannot send on a deployment without the gateway. */
export const GATEWAY_REASON =
  "The copilot cannot reply: this deployment has no invocation gateway.";

/** The notice's link, and where it leads. */
export const GATEWAY_LINK = { name: "See Providers", href: "/models/providers" } as const;

/** The notice's provider status, whatever the counts are. */
export const PROVIDER_STATUS =
  /Provider status: (?:\d+ connected — .+|no provider is connected in this workspace)\./;

/** The composer's accessible name. */
export const COMPOSER_LABEL = "Message the copilot";

/** The composer's send button. */
export const SEND_LABEL = "Send";

/* ------------------------------------------------------------------ a reader who may not write */

/** Why a member's promote is inert. */
export const PROMOTE_MEMBER_REASON = "Promoting a draft is for workspace owners and admins.";

/** Why a member's discard is inert. */
export const DISCARD_MEMBER_REASON = "Discarding a draft is for workspace owners and admins.";

/** The head's discard. */
export const DISCARD_LABEL = "Discard draft";

/** The head's promote, whatever version it names. */
export const PROMOTE_LABEL = /^Promote draft → security-patch v\d+$/;

/** What stands in the composer's place for a reader who may not continue the conversation. */
export const ROLE_TRANSCRIPT_NOTE =
  "This conversation is shown read-only: continuing it edits the workflow, which is for workspace owners and admins.";

/* ------------------------------------------------------------------ the dry-run card */

/** The pill in the card's head, verbatim. */
export const SIMULATED_PILL = "simulated — no writes · no PRs · no merges";

/** The result rows' list. */
export const ROWS_LABEL = "Dry-run results";

/** The diff's headline. */
export const DIFF_HEADLINE = "simulated diff (never written to repo)";

/** The card's controls and the suggestion's actions. */
export const RERUN_LABEL = "Re-run dry run";
/** The picker's button: **Choose an issue ▾** before the first run, **Dry-run another issue ▾** after. */
export const PICKER_LABEL = /^(Choose an issue|Dry-run another issue)/;
export const PICKER_PANEL_LABEL = "Issues to dry-run against";
export const APPLY_LABEL = "Apply to draft";
export const APPLY_TITLE = "Apply this suggestion to the draft?";
export const SUGGESTIONS_LABEL = "Suggestions";

/** The seeded dry run's issue, and the stage its first suggestion makes conditional. */
export const DRY_RUN_ISSUE = "#489";
export const SKIPPED_STAGE = "exploit-verify";

/** The `how` labels a result row can carry. */
export const HOW_LABELS = ["simulated", "replayed from history", "skipped"] as const;

/* ------------------------------------------------------------------ the chain's reads */

/** A workflow's published state, as far as the chain reads it. */
export interface WorkflowState {
  readonly currentVersion: number | null;
  readonly version: { readonly definition: Readonly<Record<string, unknown>> } | null;
  readonly draft: { readonly definition: Readonly<Record<string, unknown>> } | null;
}

/**
 * Read a workflow as the visual editor reads it.
 *
 * @param context - A signed-in context.
 * @param id - The workflow.
 * @returns The workflow.
 */
export async function readWorkflow(context: BrowserContext, id: string): Promise<WorkflowState> {
  const workflow = await requestAs<WorkflowState>(
    context,
    "GET",
    `/api/v1/workflows/${id}`,
    null,
    "reading the workflow",
  );
  if (workflow === null) throw new Error("the workflow answered with no body");

  return workflow;
}

/**
 * Find a workflow's id by its slug, on the rail's listing.
 *
 * @param context - A signed-in context.
 * @param slug - The workflow's slug.
 * @returns The id.
 */
export async function findWorkflowId(context: BrowserContext, slug: string): Promise<string> {
  const rail = await requestAs<readonly { readonly id: string; readonly slug: string }[]>(
    context,
    "GET",
    "/api/v1/workflows",
    null,
    "listing the workflows",
  );
  const entry = (rail ?? []).find((candidate) => candidate.slug === slug);
  if (entry === undefined) throw new Error(`the workspace has no workflow with the slug ${slug}`);

  return entry.id;
}

/** One guard of a promotion, with where it is enforced. */
export interface PromotionGuard {
  readonly name: string;
  readonly enforcement: "enforced" | "dry_run_only";
  readonly enforcedBy: string;
}

/**
 * Read what promoting the draft would publish — the guards with their enforcement planes.
 *
 * @param context - A signed-in context.
 * @param id - The workflow.
 * @returns The promotion summary's guards.
 */
export async function readGuards(
  context: BrowserContext,
  id: string,
): Promise<readonly PromotionGuard[]> {
  const promotion = await requestAs<{ readonly guards: readonly PromotionGuard[] }>(
    context,
    "GET",
    `/api/v1/workflows/${id}/copilot/promotion`,
    null,
    "reading the promotion summary",
  );
  if (promotion === null) throw new Error("the promotion summary answered with no body");

  return promotion.guards;
}

/**
 * The ids of a workflow document's stages, in the document's order.
 *
 * @param definition - The document.
 * @returns Each node's id.
 */
export function stageIds(definition: Readonly<Record<string, unknown>>): string[] {
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];

  return nodes.flatMap((node) =>
    typeof node === "object" && node !== null && typeof (node as { id?: unknown }).id === "string"
      ? [(node as { id: string }).id]
      : [],
  );
}
