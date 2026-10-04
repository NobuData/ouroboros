/**
 * A service principal for unit suites ([#485](https://github.com/NobuData/ouroboros/issues/485)).
 */

import { FIXTURE_ORGANIZATION } from "../tenancy/organization.fixture";
import type { ServicePrincipal } from "./service.principal";

/**
 * `devops-bot`, in the fixture workspace, holding `scopes`.
 *
 * @param scopes - The scopes it holds.
 * @returns The principal.
 */
export function servicePrincipalFor(scopes: readonly string[] = ["api.read"]): ServicePrincipal {
  return {
    accountId: "5eed0091-0000-4000-8000-000000000001",
    tokenId: "5eed0092-0000-4000-8000-000000000001",
    name: "devops-bot",
    organization: FIXTURE_ORGANIZATION,
    scopes,
  };
}
