/**
 * Deployment truth for the Settings workspace card — what this install can and cannot do about
 * its region and its training data (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483),
 * decision **S6**).
 *
 * Mockup 17 draws a region dropdown and a training switch *"locked by enterprise plan"*. On a
 * self-hosted install both would be false claims: the operator chose the region when they
 * deployed, and nothing leaves the deployment to be trained on, so there is no plan doing the
 * protecting. The functions here produce what is true instead, and nothing else in the module
 * decides it.
 *
 * **One rule for the whole card: the affordance follows the payload.** Every control that cannot
 * be used carries a {@link ControlReason}, and the card renders that reason — a control that
 * silently does nothing is the failure this file exists to rule out.
 *
 * The vocabulary is wider than this release uses on purpose. BT.4
 * ([#500](https://github.com/NobuData/ouroboros/issues/500)) adds a SaaS deployment kind with a
 * real region choice and plan-locked training controls; the `plan` reason and the plan-locked
 * training variant exist so that work fills in a shape rather than changing one. A self-hosted
 * deployment never produces either, and `workspace.truth.spec.ts` asserts both halves.
 */

/**
 * Why a control on the card cannot be used.
 *
 * - `deployment` — this deployment cannot do it at all (a self-hosted region, training data).
 * - `plan` — a plan entitlement locks it. Reserved for BT.4; never produced today.
 * - `role` — the caller's role may not change it (name and domain are administrators').
 */
export type ControlReason = "deployment" | "plan" | "role";

/** Every {@link ControlReason}, in the order the OpenAPI enum lists them. */
export const CONTROL_REASONS: readonly ControlReason[] = ["deployment", "plan", "role"];

/**
 * What kind of deployment this is. Only `self_hosted` exists until BT.4 adds the SaaS tier,
 * which is where a region becomes a choice.
 */
export type DeploymentKind = "self_hosted";

/** The one deployment kind this release can be. */
export const DEPLOYMENT_KIND: DeploymentKind = "self_hosted";

/** The region label a deployment that names none reports. */
export const UNNAMED_REGION_LABEL = "self-hosted";

/**
 * Where the security model answers *"where does my data live"* — `docs/SECURITY_MODEL.md` §6.7,
 * written by this ticket. The card's region area links here.
 */
export const RESIDENCY_DOCS_URL =
  "https://github.com/NobuData/ouroboros/blob/main/docs/SECURITY_MODEL.md#67-where-a-workspaces-data-lives";

/** The card's region area. Read-only on every deployment this release can be. */
export interface RegionPayload {
  /** The operator's `OURO_DATA_REGION`, or {@link UNNAMED_REGION_LABEL} when it is unset. */
  readonly label: string;
  /** Whether the card may offer a choice. `false` until BT.4's multi-region tier. */
  readonly selectable: false;
  /** `configured` when the operator named the region, `default` when the label is the fallback. */
  readonly source: "configured" | "default";
  /** Why the region cannot be chosen here. */
  readonly reason: "deployment";
  /** The security model's residency section — {@link RESIDENCY_DOCS_URL}. */
  readonly docsUrl: string;
}

/**
 * The card's training-data row — three variants, of which a self-hosted deployment produces
 * exactly one.
 *
 * - **Deployment** — `{enabled: false, changeable: false, reason: "deployment"}`: nothing leaves
 *   this deployment to be trained on. The only variant produced today.
 * - **Plan-locked** — `{changeable: false, reason: "plan"}`: a SaaS plan fixes the setting.
 *   Representable for BT.4, never synthesised here.
 * - **Changeable** — `{changeable: true, reason: null}`: a SaaS tenant may choose. Also BT.4's.
 */
export type TrainingDataPayload =
  | { readonly enabled: false; readonly changeable: false; readonly reason: "deployment" }
  | { readonly enabled: boolean; readonly changeable: false; readonly reason: "plan" }
  | { readonly enabled: boolean; readonly changeable: true; readonly reason: null };

/**
 * The region area, as this deployment declares it.
 *
 * @param _kind - The deployment kind. Only `self_hosted` exists; the parameter is the seam BT.4
 *   branches on, unread until then.
 * @param configured - `OURO_DATA_REGION`, or `undefined` when the operator left it unset.
 * @returns A read-only region: the configured label, or `self-hosted` with `source: "default"`.
 */
export function regionPayload(
  _kind: DeploymentKind,
  configured: string | undefined,
): RegionPayload {
  return {
    label: configured ?? UNNAMED_REGION_LABEL,
    selectable: false,
    source: configured === undefined ? "default" : "configured",
    reason: "deployment",
    docsUrl: RESIDENCY_DOCS_URL,
  };
}

/**
 * The training-data row, as this deployment can truthfully state it.
 *
 * @param _kind - The deployment kind. A self-hosted deployment has no training pipeline and no
 *   plans, so the answer is always the `deployment` variant — never the plan lock.
 * @returns `{enabled: false, changeable: false, reason: "deployment"}`.
 */
export function trainingDataPayload(_kind: DeploymentKind): TrainingDataPayload {
  return { enabled: false, changeable: false, reason: "deployment" };
}
