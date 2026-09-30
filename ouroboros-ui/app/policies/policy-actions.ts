"use server";

/**
 * The dry-run flip, as a Server Action (BA.3, #382).
 *
 * The role gate is the service's: a Server Action is a POST endpoint anybody can reach, so the
 * `403` for a member or viewer is enforced there and only translated here.
 */

import { isApiError } from "@/app/api/errors";
import { FORBIDDEN_CODE, dryRunPolicy } from "@/app/api/policies";

import { POLICY_READ_ONLY, POLICY_WRITE_FAILURE, type PolicyFlipResult } from "./view";

/**
 * Set the dry-run policy.
 *
 * @param dryRun The value to set.
 * @returns The policy as it now stands, or why it was not changed.
 */
export async function setDryRun(dryRun: boolean): Promise<PolicyFlipResult> {
  try {
    return { ok: true, policy: await dryRunPolicy.set(dryRun) };
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (error.code === FORBIDDEN_CODE) return { ok: false, reason: POLICY_READ_ONLY };

    return { ok: false, reason: error.message === "" ? POLICY_WRITE_FAILURE : error.message };
  }
}
