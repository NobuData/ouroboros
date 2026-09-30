/**
 * The seed's recipe (`R__dev_seed_workspace_knowledge.sql`) — mockup 14's four ordered commands at
 * v3, as the rows, the resource and a save body — shared by the env-recipe suites (#420).
 */

import type { SaveEnvRecipeBody } from "./env-recipes.dto";
import type { EnvRecipeResource, EnvRecipeRow } from "./env-recipes.resources";

/** The seeded repository, lower-case as V067's domain keeps it. */
export const HELIOS = "acme-robotics/helios-firmware";

/** Ken, as `"user"` names him. */
export const KEN = { id: "5eed0003-0000-4000-8000-000000000001", name: "Ken" };

/** When v3 was saved. */
export const SAVED_AT = new Date("2026-09-21T14:00:00.000Z");

/** The mockup's four commands, as the column holds them. */
export const COMMANDS = [
  {
    command: "west init -m git@github.com:acme-robotics/helios-firmware",
    comment: "manifest repo",
  },
  { command: "west update --narrow -o=--depth=1", comment: "shallow module fetch" },
  {
    command: "zephyr-sdk-install 0.17.2 --toolchains arm-zephyr-eabi",
    comment: "SDK + ARM toolchain",
  },
  { command: "ccache --set-config=max_size=8G", comment: "shared build cache" },
];

/**
 * The current-version row at v3.
 *
 * @param over - Fields to replace.
 * @returns The row.
 */
export function currentRow(over: Partial<EnvRecipeRow> = {}): EnvRecipeRow {
  return {
    repo_ref: HELIOS,
    version: 3,
    commands: COMMANDS,
    source: "edited",
    updated_by: KEN.id,
    updated_at: SAVED_AT,
    editor_name: KEN.name,
    ...over,
  };
}

/** The resource for {@link currentRow}. */
export const RECIPE: EnvRecipeResource = {
  repo: HELIOS,
  version: 3,
  commands: COMMANDS.map((entry) => ({ command: entry.command, comment: entry.comment })),
  source: "edited",
  updatedAt: SAVED_AT.toISOString(),
  updatedBy: KEN,
};

/** A save moving the SDK to 0.17.3 — what v4 would hold. */
export const SAVE_BODY: SaveEnvRecipeBody = {
  repo: HELIOS,
  commands: [
    {
      command: "west init -m git@github.com:acme-robotics/helios-firmware",
      comment: "manifest repo",
    },
    { command: "west update --narrow -o=--depth=1" },
    {
      command: "zephyr-sdk-install 0.17.3 --toolchains arm-zephyr-eabi",
      comment: "SDK + ARM toolchain",
    },
    { command: "ccache --set-config=max_size=8G", comment: "shared build cache" },
  ],
};
