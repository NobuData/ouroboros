/**
 * `WorkspaceSettings` — what `GET`/`PATCH /api/v1/settings/workspace` answer: the Settings page's
 * workspace card, every control carrying whether it can be used and, when not, why
 * (BQ.4, [#483](https://github.com/NobuData/ouroboros/issues/483)).
 *
 * The card renders affordances from this payload and nothing else — see `workspace.truth.ts` for
 * the rule and the reason vocabulary.
 */

import type {
  ControlReason,
  DeploymentKind,
  RegionPayload,
  TrainingDataPayload,
} from "./workspace.truth";

/** The tag the card shows beside a domain whose sign-ins require SSO. */
export type DomainTag = "sso_enforced";

/**
 * What changing the tenant domain does, stated where the edit happens. The card shows it beside
 * the field: a domain edit is not cosmetic.
 */
export const DOMAIN_CONSEQUENCE =
  "Changing the tenant domain changes how sign-in finds this workspace for everyone who uses it.";

/** Whether a field can be edited by this caller, and if not, why. */
export interface Editability {
  /** `true` when the caller may change the field. */
  readonly editable: boolean;
  /** Why it cannot be changed — `null` exactly when {@link editable} is `true`. */
  readonly reason: ControlReason | null;
}

/** The workspace name. */
export interface NameField extends Editability {
  /** The organization's display name. */
  readonly value: string;
}

/** The tenant domain — the workspace's primary `tenant_domains` row. */
export interface DomainField extends Editability {
  /** The primary domain, or `null` when the workspace has none (V001 permits zero). */
  readonly value: string | null;
  /**
   * Tags the card shows beside the domain. `sso_enforced` appears only when SSO is enforced;
   * it is absent — never `false` — otherwise, and always absent until #722.
   */
  readonly tags: readonly DomainTag[];
  /** {@link DOMAIN_CONSEQUENCE}, for the card to show with the edit. */
  readonly consequence: string;
}

/** The workspace card. */
export interface WorkspaceSettingsResource {
  /** The organization id. */
  readonly id: string;
  /** The organization slug. Not editable from the card. */
  readonly slug: string;
  /** The deployment kind the region and training payloads were derived from. */
  readonly deployment: DeploymentKind;
  readonly name: NameField;
  readonly domain: DomainField;
  readonly region: RegionPayload;
  readonly trainingData: TrainingDataPayload;
}

/**
 * The editability of a field gated on the administrator roles.
 *
 * @param isAdministrator - Whether the caller is an `owner` or `admin`.
 * @returns Editable with no reason, or not editable with reason `role`.
 */
export function roleEditability(isAdministrator: boolean): Editability {
  return isAdministrator ? { editable: true, reason: null } : { editable: false, reason: "role" };
}
