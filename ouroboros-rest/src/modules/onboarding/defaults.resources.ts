/**
 * The wizard's right column — the *Smart Defaults* card, the *What Happens Next* projection and
 * the reassure strip — selected by what this deployment can actually do
 * ([#388](https://github.com/NobuData/ouroboros/issues/388), BB.5, decisions **O6**, **O8**,
 * **O9**).
 *
 * ```
 * GET /api/v1/onboarding/defaults  → SmartDefaultsResource
 * ```
 *
 * Pure: facts in, payload out, so both deployments' payloads are asserted without a database.
 *
 *   * **Rows are selected, never greyed out** (O6). A deployment that declares no managed key pool
 *     gets a *different row* — bring your own keys — not a disabled promise; likewise the runner.
 *     The self-hosted payload therefore contains no managed-key or hosted-runner row at all.
 *   * **The trial credit is the deployment's own figure.** It prints only when declared; nothing
 *     here knows a default amount.
 *   * **Every reassure claim names its mechanism** (O9), and a claim whose mechanism this
 *     workspace does not have is left out rather than softened.
 *   * **No aggregate statistic** (O8). Nothing here is measured across teams, so nothing here says
 *     so.
 */

import type { BacklogHealthResource } from "../planning/planning.resources";
import { projectTimeline, type TimelineFacts, type TimelineResource } from "./launch.timeline";

/** Providers & keys (mockup 07). Mirrors the UI route. */
export const PROVIDERS_PATH = "/models/providers";

/** The build farm (mockup 08). Mirrors the UI route. */
export const BUILD_FARM_PATH = "/build-farm";

/** Settings → Sources, where a GitHub connection is paused. Mirrors the UI route. */
export const SOURCES_PATH = "/settings/sources";

/** Settings → Policies, where dry-run is flipped. Mirrors the UI route. */
export const POLICIES_PATH = "/settings/policies";

/** What the deployment declares it runs for its workspaces. */
export interface DeploymentCapabilities {
  /** A managed key pool — `OURO_MANAGED_KEY_POOL`. */
  readonly managedKeyPool: boolean;
  /** A hosted runner pool — `OURO_HOSTED_RUNNER_POOL`. */
  readonly hostedRunnerPool: boolean;
}

/** A row's place on the card. */
export type DefaultRowKey = "models" | "build" | "estimator" | "slack";

/** Which of a row's variants was selected. */
export type DefaultRowVariant =
  | "managed_keys"
  | "bring_your_own_keys"
  | "hosted_runner"
  | "enroll_runner"
  | "nightly_estimator"
  | "slack_future";

/** A link a row carries. */
export interface DefaultRowLink {
  /** The link's own words — `Providers`. */
  readonly label: string;
  /** The UI route. */
  readonly path: string;
}

/** One row of the card. */
export interface DefaultRowResource {
  readonly key: DefaultRowKey;
  readonly variant: DefaultRowVariant;
  /** `ready` draws the tick; `optional` draws the dim one. */
  readonly status: "ready" | "optional";
  /** The row's sentence, without its link. */
  readonly text: string;
  /** Where the row leads, or null when its destination does not exist yet. */
  readonly link: DefaultRowLink | null;
  /** The managed pool's trial credit — only on `managed_keys`, only when the deployment declares one. */
  readonly trialCredit?: { readonly cents: number; readonly display: string };
  /** The nightly job's schedule and last run — only on `nightly_estimator`. */
  readonly estimator?: BacklogHealthResource["reestimation"];
  /** What the row waits for — only on `slack_future`. */
  readonly arrivesWith?: string;
}

/** A reassure claim's place on the strip. */
export type ReassureClaimKey = "draft_only" | "uninstall" | "vault";

/** The mechanism a claim is true because of. */
export interface ReassureMechanismResource {
  /** The mechanism's stable name — `dry_run_policy`. */
  readonly key:
    "dry_run_policy" | "github_app_uninstall" | "source_pause" | "vault_envelope_encryption";
  /** What it does, in a sentence. */
  readonly description: string;
  /** The issue that delivered it. */
  readonly issue: number;
  /** Where a person operates or inspects it, or null when it is not in this app. */
  readonly path: string | null;
}

/** One claim of the strip. */
export interface ReassureClaimResource {
  readonly key: ReassureClaimKey;
  /** The sentence the strip prints. */
  readonly text: string;
  readonly mechanism: ReassureMechanismResource;
}

/** `GET /api/v1/onboarding/defaults`. */
export interface SmartDefaultsResource {
  /** `acme-robotics/helios-firmware`, lower-case. */
  readonly repo: string;
  /** `saas` when either pool is declared, else `self_hosted`. */
  readonly deployment: "self_hosted" | "saas";
  readonly capabilities: DeploymentCapabilities;
  /** The card's rows, in card order. */
  readonly rows: readonly DefaultRowResource[];
  readonly reassure: {
    /** The claims true of this workspace, in strip order. */
    readonly claims: readonly ReassureClaimResource[];
    /** The claims' sentences joined — the strip's one line. Empty when no claim holds. */
    readonly line: string;
  };
  /** *What Happens Next* for the picked issue — a projection, labelled as one on every row. */
  readonly timeline: TimelineResource;
}

/** How the repository reaches GitHub — what decides the uninstall claim. */
export type ConnectionFact =
  | { readonly kind: "app"; readonly login: string }
  | { readonly kind: "token"; readonly login: string }
  | null;

/** The dry-run policy, as the draft-only claim reads it. */
export interface DryRunFact {
  /** Whether dry-run is active now. */
  readonly active: boolean;
  /** Whether that is a stored answer, or a workspace that never answered. */
  readonly explicit: boolean;
}

/** Everything the payload is selected from. */
export interface SmartDefaultsFacts {
  readonly repo: string;
  readonly capabilities: DeploymentCapabilities;
  /** The declared trial credit in cents, or undefined. Read only with a managed key pool. */
  readonly trialCents: number | undefined;
  /** The nightly estimator's schedule and last run (AL.5, #281). */
  readonly estimator: BacklogHealthResource["reestimation"];
  readonly connection: ConnectionFact;
  readonly dryRun: DryRunFact;
  /** The wizard's picked issue and its estimate's cycle range, or null when nothing is picked. */
  readonly pick: { readonly issueKey: string; readonly cycle: TimelineFacts["cycle"] } | null;
}

/**
 * A trial credit as the card prints it.
 *
 * @param cents - Whole cents.
 * @returns `$5` for whole dollars, `$5.50` otherwise.
 */
export function formatCredit(cents: number): string {
  return cents % 100 === 0 ? `$${String(cents / 100)}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * The models row: managed keys where the deployment runs a pool, bring-your-own where it does not.
 *
 * @param managed - Whether a managed key pool is declared.
 * @param trialCents - The declared trial credit, or undefined.
 * @returns The row.
 */
function modelsRow(managed: boolean, trialCents: number | undefined): DefaultRowResource {
  if (!managed) {
    return {
      key: "models",
      variant: "bring_your_own_keys",
      status: "ready",
      text: "Models: bring your own keys",
      link: { label: "Providers", path: PROVIDERS_PATH },
    };
  }

  const credit =
    trialCents === undefined ? undefined : { cents: trialCents, display: formatCredit(trialCents) };

  return {
    key: "models",
    variant: "managed_keys",
    status: "ready",
    text:
      credit === undefined
        ? "Models: managed keys"
        : `Models: managed keys with ${credit.display} trial credit`,
    link: { label: "bring your own keys anytime", path: PROVIDERS_PATH },
    ...(credit === undefined ? {} : { trialCredit: credit }),
  };
}

/**
 * The build row: the hosted runner where the deployment runs one, enroll-first where it does not.
 *
 * @param hosted - Whether a hosted runner pool is declared.
 * @returns The row.
 */
function buildRow(hosted: boolean): DefaultRowResource {
  return hosted
    ? {
        key: "build",
        variant: "hosted_runner",
        status: "ready",
        text: "Build: hosted runner for your first loops",
        link: { label: "enroll your own farm later", path: BUILD_FARM_PATH },
      }
    : {
        key: "build",
        variant: "enroll_runner",
        status: "ready",
        text: "Build: enroll a runner",
        link: { label: "Build Farm", path: BUILD_FARM_PATH },
      };
}

/**
 * The card's rows for one deployment.
 *
 * @param facts - The capability flags, the trial credit and the nightly job's status.
 * @returns Four rows in card order: models, build, estimator, Slack.
 */
export function defaultRows(
  facts: Pick<SmartDefaultsFacts, "capabilities" | "trialCents" | "estimator">,
): DefaultRowResource[] {
  return [
    modelsRow(facts.capabilities.managedKeyPool, facts.trialCents),
    buildRow(facts.capabilities.hostedRunnerPool),
    {
      key: "estimator",
      variant: "nightly_estimator",
      status: "ready",
      text: "Estimator pre-sizes your backlog overnight",
      link: null,
      estimator: facts.estimator,
    },
    {
      key: "slack",
      variant: "slack_future",
      status: "optional",
      text: "Slack: connect after your first PR (optional)",
      // Dim and unlinked: there is no Slack surface to send anyone to yet.
      link: null,
      arrivesWith: "ChatOps",
    },
  ];
}

/**
 * The draft-only claim — true while dry-run is on, and true of a workspace that never answered
 * because launching the first loop turns it on (BA.3, #382). An explicit *off* drops the claim.
 *
 * @param dryRun - The policy.
 * @returns The claim, or undefined when the workspace turned dry-run off.
 */
function draftOnlyClaim(dryRun: DryRunFact): ReassureClaimResource | undefined {
  if (!dryRunAtLaunch(dryRun)) {
    return undefined;
  }

  return {
    key: "draft_only",
    text: "Nothing is written to main.",
    mechanism: {
      key: "dry_run_policy",
      description: dryRun.active
        ? "The dry-run policy is on: loops open draft pull requests, and merging is refused until an owner or admin turns it off."
        : "Running your first loop turns the dry-run policy on: loops open draft pull requests, and merging is refused until an owner or admin turns it off.",
      issue: 382,
      path: POLICIES_PATH,
    },
  };
}

/**
 * The uninstall claim, by how the repository reaches GitHub: an App installation can be
 * uninstalled; a token connection can be paused; no connection has nothing to remove.
 *
 * @param connection - The covering source, as App or token, or null.
 * @returns The claim, or undefined when nothing is connected.
 */
function uninstallClaim(connection: ConnectionFact): ReassureClaimResource | undefined {
  if (connection === null) {
    return undefined;
  }

  if (connection.kind === "app") {
    return {
      key: "uninstall",
      text: "The app can be uninstalled in one click.",
      mechanism: {
        key: "github_app_uninstall",
        description: `Uninstalling the GitHub App from ${connection.login} on GitHub revokes its access; the source then reads as disconnected.`,
        issue: 122,
        path: SOURCES_PATH,
      },
    };
  }

  return {
    key: "uninstall",
    text: "The GitHub connection can be paused in one click.",
    mechanism: {
      key: "source_pause",
      description: `Pausing the ${connection.login} source in Settings → Sources stops every read of it until it is resumed.`,
      issue: 141,
      path: SOURCES_PATH,
    },
  };
}

/** The vault claim — every deployment has the vault: the service does not start without its key. */
const VAULT_CLAIM: ReassureClaimResource = {
  key: "vault",
  text: "Your keys are sealed in the tenant vault and never leave the control plane.",
  mechanism: {
    key: "vault_envelope_encryption",
    description:
      "Every stored credential is envelope-encrypted under this workspace's own data key; only ciphertext is stored.",
    issue: 222,
    path: PROVIDERS_PATH,
  },
};

/**
 * The reassure strip's claims for one workspace — only those whose mechanism it has.
 *
 * @param facts - The dry-run policy and the repository's connection.
 * @returns The claims in strip order.
 */
export function reassureClaims(
  facts: Pick<SmartDefaultsFacts, "connection" | "dryRun">,
): ReassureClaimResource[] {
  return [draftOnlyClaim(facts.dryRun), uninstallClaim(facts.connection), VAULT_CLAIM].filter(
    (claim): claim is ReassureClaimResource => claim !== undefined,
  );
}

/**
 * The whole payload.
 *
 * @param facts - What the service read.
 * @returns The resource.
 */
export function smartDefaultsResource(facts: SmartDefaultsFacts): SmartDefaultsResource {
  const { capabilities } = facts;
  const claims = reassureClaims(facts);

  return {
    repo: facts.repo,
    deployment:
      capabilities.managedKeyPool || capabilities.hostedRunnerPool ? "saas" : "self_hosted",
    capabilities: {
      managedKeyPool: capabilities.managedKeyPool,
      hostedRunnerPool: capabilities.hostedRunnerPool,
    },
    rows: defaultRows(facts),
    reassure: { claims, line: claims.map((claim) => claim.text).join(" ") },
    timeline: projectTimeline({
      issueKey: facts.pick?.issueKey ?? null,
      cycle: facts.pick?.cycle ?? null,
      dryRun: dryRunAtLaunch(facts.dryRun),
    }),
  };
}

/**
 * Whether the first loop will run under dry-run: the policy is on, or the workspace never
 * answered — launching turns it on (BA.3, #382). Only an explicit *off* is off.
 *
 * @param dryRun - The policy.
 * @returns True unless the workspace turned dry-run off.
 */
export function dryRunAtLaunch(dryRun: DryRunFact): boolean {
  return dryRun.active || !dryRun.explicit;
}
