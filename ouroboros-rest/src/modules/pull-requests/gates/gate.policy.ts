/**
 * The workspace's say over its gates — overrides and the license allow-list — behind a port.
 *
 * AX.2 ([#358](https://github.com/NobuData/ouroboros/issues/358)) materializes gates from *"the
 * pinned workflow policy and org config"*, and no org-config table exists yet: the versioned org
 * policy document is BQ.1 ([#480](https://github.com/NobuData/ouroboros/issues/480)) and its
 * resolver BQ.2 ([#481](https://github.com/NobuData/ouroboros/issues/481)). So the engine reads org
 * config through {@link OrgGatePolicy}, bound to {@link DEFAULT_ORG_GATE_POLICY} — no overrides and
 * a permissive allow-list — and #481 rebinds {@link ORG_GATE_POLICY} to its resolver without the
 * engine changing.
 *
 * **Since #461** the module binds {@link ORG_GATE_POLICY} to `OrgPolicyGateResolver`
 * (`gate.org-policy.ts`), which keeps these defaults for overrides and licenses and adds the one
 * rule the inbox needs now: the published policy's `human_review`. #481 widens that resolver.
 */

import type { BuiltInGateKey } from "../../db/schema";
import type { HumanReviewRule } from "./gate.human-review";
import { isKnownLicense } from "./gate.spdx";

/** One org override of one built-in gate. */
export interface GateOverride {
  /** Force the gate required or advisory. */
  readonly required?: boolean;
  /** Switch the gate off: advisory, and its verdict is `not_required`. */
  readonly disabled?: boolean;
}

/** Which licenses a workspace accepts — SPDX ids, compared case-insensitively. */
export interface LicensePolicy {
  /** Licenses a changed file's header or a new dependency may carry. */
  readonly allow: readonly string[];
  /** Licenses refused even when allowed — a deny wins. */
  readonly deny: readonly string[];
}

/** Everything a workspace configures about its gates. */
export interface OrgGateConfig {
  /** Per-gate overrides, applied on top of the pinned policy. */
  readonly overrides: Readonly<Partial<Record<BuiltInGateKey, GateOverride>>>;
  /** The license layer's allow-list. */
  readonly license: LicensePolicy;
  /**
   * The published org policy's `human_review` rule (V092 `org_policy_versions`, #461's #358
   * amendment) — *anything labeled refactor needs a human*. Null or absent when the workspace has
   * published no policy.
   */
  readonly humanReview?: HumanReviewRule | null;
}

/** The port. */
export interface OrgGatePolicy {
  /**
   * @param organizationId - The workspace.
   * @returns Its gate configuration.
   */
  forOrganization(organizationId: string): Promise<OrgGateConfig>;
}

/** The injection token. */
export const ORG_GATE_POLICY = Symbol("ORG_GATE_POLICY");

/**
 * The permissive licenses a workspace accepts when it has said nothing — each an SPDX id. Copyleft
 * (GPL, LGPL, AGPL, MPL, EPL) is left out on purpose: a new GPL dependency is exactly the regression
 * the license layer exists to catch.
 */
export const DEFAULT_LICENSE_ALLOW_LIST = Object.freeze([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Zlib",
  "Unlicense",
  "CC0-1.0",
  "BSL-1.0",
]);

/** The configuration of a workspace that has configured nothing. */
export const DEFAULT_ORG_GATE_CONFIG: OrgGateConfig = Object.freeze({
  overrides: Object.freeze({}),
  license: Object.freeze({ allow: DEFAULT_LICENSE_ALLOW_LIST, deny: Object.freeze([]) }),
});

/** The binding until #481's resolver lands: every workspace at the defaults. */
export const DEFAULT_ORG_GATE_POLICY: OrgGatePolicy = Object.freeze({
  forOrganization: () => Promise.resolve(DEFAULT_ORG_GATE_CONFIG),
});

/**
 * Every id in a license policy that the bundled SPDX list does not know — a typo in an allow-list
 * would otherwise silently refuse the license it meant to admit.
 *
 * @param policy - The allow- and deny-lists.
 * @returns The unknown ids, in list order.
 */
export function unknownLicenseIds(policy: LicensePolicy): string[] {
  return [...policy.allow, ...policy.deny].filter((id) => !isKnownLicense(id));
}
