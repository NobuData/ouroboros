/**
 * Every string in the product that says the loop is simulated, or that part of it is not
 * available — with what makes it false and whose it is (DG.3,
 * [#1301](https://github.com/NobuData/ouroboros/issues/1301)).
 *
 * ```
 * entry ─▶ file · text (verbatim, asserted present) · what makes it false · owner · how it is shown
 * ```
 *
 * Shown as:
 *
 * - **`capability`** — drawn only when DG.2's report says the stage is off, with the reason and
 *   the fix (`app/loop/capability-copy.ts`). DG.3 owns these.
 * - **`service`** — drawn only when a service answer already says so (a guard's enforcement, a
 *   gateway's presence, a connection's terms); its owner wired it.
 * - **`per-run`** — keyed to one run's origin (DJ.1), so it stays on an old simulated run
 *   whatever the deployment can do now.
 * - **`until-owner`** — a fixed sentence that stays true until its owner ships; its owner
 *   changes it when it does.
 *
 * `__tests__/loop/copy-inventory.test.ts` asserts every entry's text is in its file, that every
 * entry has an owner, and that every retired string is gone. A new claim of this kind is added
 * here in the change that writes it.
 */

import type { LoopStage } from "@/app/api/loop";

/** What makes a string false. */
export type ClaimFalsifier =
  /** A stage of DG.2's report becoming available. */
  | LoopStage
  /** Nothing about the deployment: the run's own origin decides (DJ.1, #1313). */
  | "run-origin"
  /** A feature or route that is not a loop stage, shipped by its owner. */
  | "feature";

/** How a string is shown. */
export type ClaimHandling = "capability" | "service" | "per-run" | "until-owner";

/** One inventoried string. */
export interface ClaimEntry {
  /** Where it is drawn, as a reader would name it. */
  readonly surface: string;
  /** The file it is written in, from the module root. */
  readonly file: string;
  /** The string, or a verbatim part of it. */
  readonly text: string;
  readonly falsifiedBy: ClaimFalsifier;
  /** The issue that owns making it false. */
  readonly owner: number;
  readonly handling: ClaimHandling;
}

/** DG.3 itself. */
const DG3 = 1301;

export const CLAIM_INVENTORY: readonly ClaimEntry[] = [
  // --- the run console -----------------------------------------------------------------
  {
    surface: "Run console — simulated-run banner",
    file: "app/runs/view.ts",
    text: "Simulated run.",
    falsifiedBy: "run-origin",
    owner: DG3,
    handling: "per-run",
  },
  {
    surface: "Run console — simulated-run banner",
    file: "app/runs/view.ts",
    text: "no executor, repository or model did",
    falsifiedBy: "run-origin",
    owner: DG3,
    handling: "per-run",
  },
  {
    surface: "Run console — deployment notice",
    file: "app/loop/capability-copy.ts",
    text: "Live execution is off for this deployment — ask an administrator.",
    falsifiedBy: "execution",
    owner: DG3,
    handling: "capability",
  },
  {
    surface: "Run console — deployment notice",
    file: "app/loop/capability-copy.ts",
    text: "No runner is online — builds will wait.",
    falsifiedBy: "buildIntegration",
    owner: DG3,
    handling: "capability",
  },
  {
    surface: "Run console — take over",
    file: "app/runs/handoff.ts",
    text: "Deep IDE integration is arriving (#316).",
    falsifiedBy: "feature",
    owner: 316,
    handling: "until-owner",
  },

  // --- Models › Registry ---------------------------------------------------------------
  {
    surface: "Models › Registry — resolution chain tag",
    file: "app/registry/chain.ts",
    text: "simulated — no run has resolved it yet",
    falsifiedBy: "invocation",
    owner: DG3,
    handling: "capability",
  },
  {
    surface: "Models › Registry — resolution chain notice",
    file: "app/loop/capability-copy.ts",
    text: "No provider connection can be invoked — models cannot be called.",
    falsifiedBy: "invocation",
    owner: DG3,
    handling: "capability",
  },

  // --- Models › Providers --------------------------------------------------------------
  {
    surface: "Models › Providers — connection card",
    file: "app/providers/cards.ts",
    text: "Cannot run a loop",
    falsifiedBy: "invocation",
    owner: 1304,
    handling: "service",
  },
  {
    surface: "Models › Providers — spend cap",
    file: "app/providers/caps.ts",
    text: "At the cap, model calls skip this provider — nothing else stops.",
    falsifiedBy: "feature",
    owner: 237,
    handling: "until-owner",
  },

  // --- Settings › Policies -------------------------------------------------------------
  {
    surface: "Settings › Policies — monthly cap",
    file: "app/policies/rule-editors.tsx",
    text: "Its enforcement arrives with cap enforcement (#237).",
    falsifiedBy: "feature",
    owner: 237,
    handling: "until-owner",
  },

  // --- Dashboard -----------------------------------------------------------------------
  {
    surface: "Dashboard — Active loops, Open run console",
    file: "app/dashboard/active-loops-card.tsx",
    text: "The list of every run is not built yet",
    falsifiedBy: "feature",
    owner: 49,
    handling: "until-owner",
  },
  {
    surface: "Dashboard — Active loops, +N more",
    file: "app/dashboard/active-loops-card.tsx",
    text: "The full list of runs is not built yet",
    falsifiedBy: "feature",
    owner: 49,
    handling: "until-owner",
  },
  {
    surface: "Dashboard — queue, Pull next",
    file: "app/dashboard/view.ts",
    text: "which arrives with its ingestion bridge (#91)",
    falsifiedBy: "execution",
    owner: 91,
    handling: "until-owner",
  },

  // --- Build Farm ----------------------------------------------------------------------
  {
    surface: "Build Farm — full-log sheet",
    file: "app/farm/live.ts",
    text: "A build links to its run console with #265",
    falsifiedBy: "feature",
    owner: 265,
    handling: "until-owner",
  },

  // --- Pull requests -------------------------------------------------------------------
  {
    surface: "Pull request — review thread watermark",
    file: "app/prs/thread.ts",
    text: 'SIMULATED_MARK = "simulated"',
    falsifiedBy: "invocation",
    owner: 371,
    handling: "until-owner",
  },
  {
    surface: "Pull request — review thread watermark",
    file: "app/prs/thread.ts",
    text: "Real second-model reviews arrive with the provider stack.",
    falsifiedBy: "invocation",
    owner: 371,
    handling: "until-owner",
  },
  {
    surface: "Pull request — verification gates, unavailable review",
    file: "app/prs/gates.ts",
    text: 'UNAVAILABLE_NOTE = "arrives with the provider stack"',
    falsifiedBy: "invocation",
    owner: 371,
    handling: "until-owner",
  },
  {
    surface: "Pull request — merge receipt",
    file: "app/prs/merge-receipt.ts",
    text: "bot identity arrives with the GitHub App (#374)",
    falsifiedBy: "prPublishing",
    owner: 374,
    handling: "until-owner",
  },

  // --- Test results --------------------------------------------------------------------
  {
    surface: "Test results — failure triage slot",
    file: "app/test-results/failure.ts",
    text: "AI triage arrives with the provider stack",
    falsifiedBy: "invocation",
    owner: 343,
    handling: "until-owner",
  },
  {
    surface: "Test results — timeline",
    file: "app/test-results/timeline.ts",
    text: "PR publishing activates with the PR plane",
    falsifiedBy: "prPublishing",
    owner: 344,
    handling: "until-owner",
  },
  {
    surface: "Test results — mark as blocking",
    file: "app/test-results/mark-route.ts",
    text: "Enforcement activates with the PR plane",
    falsifiedBy: "prPublishing",
    owner: 344,
    handling: "until-owner",
  },
  {
    surface: "Test results — waive dialog",
    file: "app/test-results/mark-route-decision.ts",
    text: "PR annotation arrives with the PR plane (#344)",
    falsifiedBy: "prPublishing",
    owner: 344,
    handling: "until-owner",
  },

  // --- Workflows -----------------------------------------------------------------------
  {
    surface: "Workflows › Copilot — guard enforcement",
    file: "app/workflows/copilot/copilot-view.ts",
    text: "Not enforced on real runs yet",
    falsifiedBy: "guardrailEnforcement",
    owner: 315,
    handling: "service",
  },
  {
    surface: "Workflows › Copilot — guard enforcement",
    file: "app/workflows/copilot/copilot-view.ts",
    text: "it is checked in dry runs only, and a real run is not held to it yet",
    falsifiedBy: "guardrailEnforcement",
    owner: 315,
    handling: "service",
  },
  {
    surface: "Workflows › Copilot — composer",
    file: "app/workflows/copilot/conversation.ts",
    text: "The copilot cannot reply: this deployment has no invocation gateway.",
    falsifiedBy: "invocation",
    owner: 569,
    handling: "service",
  },
  {
    surface: "Workflows › Copilot — gateway notice",
    file: "app/workflows/copilot/conversation.ts",
    text: "The copilot needs the invocation gateway",
    falsifiedBy: "invocation",
    owner: 569,
    handling: "service",
  },
  {
    surface: "Workflows › Copilot — gateway notice",
    file: "app/workflows/copilot/conversation.ts",
    text: "This deployment has no invocation gateway, so no model can be called",
    falsifiedBy: "invocation",
    owner: 569,
    handling: "service",
  },
  {
    surface: "Workflows — inspector guardrails",
    file: "app/workflows/inspector/inspector.ts",
    text: "Declared now — enforced at execution (T.6, #160).",
    falsifiedBy: "guardrailEnforcement",
    owner: 160,
    handling: "until-owner",
  },

  // --- Research ------------------------------------------------------------------------
  {
    surface: "Research — start controls",
    file: "app/research/states.ts",
    text: "Research needs the invocation gateway — see Providers.",
    falsifiedBy: "invocation",
    owner: 633,
    handling: "service",
  },
  {
    surface: "Research — gateway notice",
    file: "app/research/states.ts",
    text: "This deployment has no invocation gateway, so a new investigation cannot be started",
    falsifiedBy: "invocation",
    owner: 633,
    handling: "service",
  },

  // --- Get started ---------------------------------------------------------------------
  {
    surface: "Get started — What happens next",
    file: "app/get-started/defaults-view.ts",
    text: "Projected first loop",
    falsifiedBy: "execution",
    owner: 396,
    handling: "until-owner",
  },
  {
    surface: "Get started — What happens next",
    file: "app/get-started/defaults-view.ts",
    text: 'PROJECTED_LABEL = "projected"',
    falsifiedBy: "execution",
    owner: 396,
    handling: "until-owner",
  },
  {
    surface: "Get started — What happens next",
    file: "app/get-started/defaults-view.ts",
    text: "A projection: nothing has been timed yet.",
    falsifiedBy: "execution",
    owner: 396,
    handling: "until-owner",
  },
  {
    surface: "Get started — What happens next",
    file: "app/get-started/defaults-view.ts",
    text: "Nothing here has been timed yet.",
    falsifiedBy: "execution",
    owner: 396,
    handling: "until-owner",
  },

  // --- Analyzer ------------------------------------------------------------------------
  {
    surface: "Analyzer — suggestion card, Simulate on last 50 loops",
    file: "app/analyzer/suggestions-view.ts",
    text: "Simulating a workflow change on past loops arrives with BX.2 (#523).",
    falsifiedBy: "feature",
    owner: 523,
    handling: "until-owner",
  },
];

/**
 * Strings DG.3 retired: each one said a part of the loop was simulated or not built when the
 * product could already do it. The test asserts none comes back anywhere under `app/`.
 */
export const RETIRED_CLAIMS: readonly string[] = [
  "simulated — live runs arrive with invocation",
  "The run console is not built yet",
  "The run console arrives with #309",
];

/**
 * Not inventoried, on purpose — "simulated" or "dry run" that describes the thing itself, not
 * the loop's availability: the routing simulator (Models, the inspector's Simulate route), a
 * workflow dry-run, the onboarding dry-run policy, hardware-in-the-loop simulation in test
 * results, projected spend and analyzer impact, and controls for features that are not stages
 * of the loop (the Copilot's unknown stage kinds, a draft's runnable state).
 */
export const NOT_INVENTORIED = [
  "routing simulator",
  "workflow dry run",
  "onboarding dry-run policy",
  "hardware simulation",
  "projections",
  "non-loop features",
] as const;
