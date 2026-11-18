import { describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@/app/api/workflows";
import {
  DEFAULT_POOL_REFERENCE,
  type PoolChoice,
  UNKNOWN_POOL_CODE,
  WORKSPACE_DEFAULT_LABEL,
  defaultOptionLabel,
  isKnownPool,
  onlineLabel,
  poolChoices,
  poolErrors,
  poolOptionLabel,
  unknownOptionLabel,
  unknownPoolFindings,
  unknownPoolMessage,
} from "@/app/workflows/pools";

import { farmRunner, runnerPool, seededFarm } from "../helpers/farm";

/**
 * The Studio's runner pools (FE.2, [#1835](https://github.com/NobuData/ouroboros/issues/1835)): the
 * choices the picker offers, and the unknown-pool check the inspector and the publish gate share.
 */

/** The seeded workspace's pools: pool-a (default) and pool-b, two runners online in each. */
const POOLS: readonly PoolChoice[] = [
  { name: "pool-a", isDefault: true, enabled: true, online: 2 },
  { name: "pool-b", isDefault: false, enabled: true, online: 2 },
];

describe("the choices", () => {
  it("counts a pool's connected runners — online, building and draining — and not an offline one", () => {
    expect(poolChoices(seededFarm())).toEqual(POOLS);
  });

  it("counts nothing for a pool with no runners, and keeps a disabled pool", () => {
    const page = {
      pools: [runnerPool({ id: "p1", name: "macos", enabled: false, isDefault: false })],
      runners: [farmRunner({ poolId: "elsewhere", status: "online" })],
    };

    expect(poolChoices(page)).toEqual([{ name: "macos", isDefault: false, enabled: false, online: 0 }]);
  });
});

describe("the labels", () => {
  it("names a pool with its online count, and says when it is disabled", () => {
    expect(onlineLabel(1)).toBe("1 online");
    expect(onlineLabel(0)).toBe("none online");
    expect(poolOptionLabel(POOLS[0])).toBe("pool-a · 2 online");
    expect(poolOptionLabel({ name: "macos", isDefault: false, enabled: false, online: 0 })).toBe(
      "macos · none online · disabled",
    );
  });

  it("names the pool Workspace default resolves to, and nothing when there is no default", () => {
    expect(defaultOptionLabel(POOLS)).toBe(`${WORKSPACE_DEFAULT_LABEL} (pool-a · 2 online)`);
    expect(defaultOptionLabel([])).toBe(WORKSPACE_DEFAULT_LABEL);
    expect(unknownOptionLabel("pool-typo")).toBe("pool-typo (unknown)");
  });
});

describe("the check", () => {
  it("knows $default and every pool by name, and nothing else", () => {
    expect(isKnownPool(DEFAULT_POOL_REFERENCE, [])).toBe(true);
    expect(isKnownPool("pool-b", POOLS)).toBe(true);
    expect(isKnownPool("pool-c", POOLS)).toBe(false);
    // Names are exact: a pool name is a slug, and the run matches it exactly.
    expect(isKnownPool("Pool-A", POOLS)).toBe(false);
  });

  it("flags an unknown pool on the field, and nothing for a known, absent or unread one", () => {
    expect(poolErrors({ runner_pool: "pool-c" }, POOLS)).toEqual({ runner_pool: unknownPoolMessage("pool-c") });
    expect(poolErrors({ runner_pool: "pool-a" }, POOLS)).toEqual({});
    expect(poolErrors({ runner_pool: DEFAULT_POOL_REFERENCE }, POOLS)).toEqual({});
    expect(poolErrors({}, POOLS)).toEqual({});
    expect(poolErrors({ runner_pool: "pool-c" }, null)).toEqual({});
  });

  it("finds each stage naming an unknown pool, anchored to its node and its runner_pool", () => {
    const definition: WorkflowDefinition = {
      nodes: [
        { id: "plan", type: "llm", config: { mode: "prompt" } },
        { id: "build", type: "infra", config: { runner_pool: "pool-typo" } },
        { id: "test", type: "infra", config: { runner_pool: DEFAULT_POOL_REFERENCE } },
        { id: "lint", type: "infra", config: { runner_pool: "pool-b" } },
        { id: "deploy", type: "infra", config: {} },
        "not a node",
      ],
      edges: [],
    };

    expect(unknownPoolFindings(definition, POOLS)).toEqual([
      {
        source: "dsl",
        code: UNKNOWN_POOL_CODE,
        message: unknownPoolMessage("pool-typo"),
        path: "/nodes/1/config/runner_pool",
        node: "build",
      },
    ]);
  });

  it("finds nothing in a definition with no nodes", () => {
    expect(unknownPoolFindings({}, POOLS)).toEqual([]);
  });
});
