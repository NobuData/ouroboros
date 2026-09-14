/**
 * The model registry aliases mockup 04's canvas pins, for an integration bench that publishes it.
 *
 * CH.6 ([#589](https://github.com/NobuData/ouroboros/issues/589)) makes a publish resolve every
 * `pinned_model` against the publishing workspace's registry, so a bench that publishes
 * `valid/standard-fix.json` needs the two aliases that document names — `coder-std` on `analyze`,
 * `coder-max` on `plan` and `review` — or its publish is refused for exactly the reason the
 * governance rule exists.
 *
 * **Unbound and switched off, on purpose.** A pin names an alias that exists; whether it is bound
 * or on is resolution's question and not publish's. Seeding them unbound keeps the bench free of
 * provider connections it has no other use for — and makes every publish that succeeds here a
 * small proof that the gate does not confuse *exists* with *usable*.
 *
 * Rows are written with SQL rather than through `POST /registry/aliases`, for the reason the
 * routing benches give: arranging a fixture through a service under test makes the arrangement
 * part of what is asserted.
 *
 * Nothing here ships: `*.fixture.ts` is outside `tsconfig.build.json`.
 */

import type { ApiHarness } from "../../testing/harness.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { RegistryAlias } from "./alias.suggestion";

/** The aliases `valid/standard-fix.json` pins, with the models the dev seed binds them to. */
export const STANDARD_FIX_PINS: readonly RegistryAlias[] = [
  { alias: "coder-max", modelId: "claude-fable-5" },
  { alias: "coder-std", modelId: "claude-sonnet-5" },
];

/**
 * Give a workspace the registry aliases a document pins.
 *
 * @param api - The running harness.
 * @param organizationId - The workspace.
 * @param pins - The aliases to create. Defaults to {@link STANDARD_FIX_PINS}.
 */
export async function seedPinnedAliases(
  api: ApiHarness,
  organizationId: string,
  pins: readonly RegistryAlias[] = STANDARD_FIX_PINS,
): Promise<void> {
  for (const pin of pins) {
    await api.sql.query(
      `insert into ${SCHEMA_NAME}.model_aliases
         (organization_id, alias, provider_connection_id, model_id, enabled)
       values ($1, $2, null, $3, false)`,
      [organizationId, pin.alias, pin.modelId],
    );
  }
}
