import { ApiHarness } from "../../testing/harness.fixture";
import { ProviderStub } from "../provider-health/provider.stub.fixture";
import { SCHEMA_NAME, type EscalationThen, type EscalationWhen } from "../db/schema";
import type { ResolutionContext } from "./context";
import { FLOOR_CODES, HOP_CODES, KEPT_HOP_CODES, RESOLUTION_FAILURE_CODES } from "./explanations";
import { isLocalProvider } from "./locality";
import { RESOLUTION_VERSION, type Resolution, type ResolutionHop } from "./resolution";
import { ResolutionService } from "./resolution.service";
import {
  BENCH_MAX_COST_CENTS,
  clearRules,
  addRule,
  seedRoutingBench,
  setHealth,
  setPolicy,
  type RoutingBench,
} from "./workspace.fixture";

/**
 * The resolution matrix, against a migrated database
 * ([#199](https://github.com/NobuData/ouroboros/issues/199)).
 *
 * Z.1's own suites answer for `resolve()` twice already — `resolve.spec.ts` runs the decision
 * table over hand-written values, and `routing.integration-spec.ts` runs a dozen named cases
 * over rows. Neither of them is this, and the difference is the reason this ticket exists.
 *
 * **A routing bug does not throw.** It returns a *different valid-looking chain*, and every run
 * afterwards goes somewhere slightly wrong until a bill or a latency graph gives it away. What
 * catches that is not another named case — a named case is written by somebody who already
 * suspected the bug — but the **cross product**, asserted against the promises the page makes
 * rather than against an expected chain per cell. So this suite resolves the whole of
 *
 * ```
 * rules × health × floor × allow_local_fallback × cost cap
 * ```
 *
 * against real rows, twice each, and then states mockup 06's headline promises as invariants
 * that must hold in **every** cell:
 *
 *   * the floor is never silently crossed, and a breach refuses rather than degrades;
 *   * a route with local turned off never runs on a local provider, and a `route_local` rule
 *     never leaves a cloud one running;
 *   * a hop the health column calls unusable is never kept, and one nothing has *checked* is
 *     never dropped — decision **M8**, the difference between *we looked and it is down* and
 *     *nobody looked*;
 *   * every hop carries a code from the closed set and a sentence saying why; and
 *   * identical inputs produce an identical answer, byte for byte.
 *
 * An invariant fails by naming the cell, so a regression reports the one combination that
 * broke rather than *480 assertions failed*.
 *
 * ---------------------------------------------------------------------------
 * **Deleting the floor check in `resolve.ts` turns this suite red**, which is the ticket's
 * second acceptance criterion. It is not a claim about a test that happens to mention floors:
 * with `HOP_CODES.belowFloor` removed, every cell whose floor is shallower than its healthy
 * chain keeps a deeper hop, and *the floor is never crossed* fails on the first of them.
 *
 * ---------------------------------------------------------------------------
 * **Every cell is resolved with two loopback providers listening, and neither is ever
 * contacted.** The local connections' `base_url` points at a {@link ProviderStub} that answers
 * `200` to anything and records what it was asked; after the whole matrix has run, both stubs
 * have received nothing. That is Z.3's passive-first promise seen from routing's side: a
 * resolution reads `provider_connections.status` and the `health` column, and a decision that
 * reached for a socket would put an outbound request on the path of every run.
 *
 * ---------------------------------------------------------------------------
 * **The whole matrix is resolved once, in `beforeAll`, and the assertions read what it
 * produced.** Resolving inside each `it` would repeat 480 cells per invariant; the rows are
 * only interesting as the inputs to the answers, and the answers are values. It is also what
 * lets a landmark case be a *lookup* — `outcomeOf({...})` — rather than a second arrangement
 * that could drift from the cell the invariants were checked over.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The task kind every cell resolves. Its chain is cloud, cloud, local — see the fixture. */
const KIND = "implement";

/** How a rules case names itself. */
type RulesKey = "none" | "escalate" | "prepend" | "vote" | "local";

/** How a health case names itself. */
type HealthKey = "all-active" | "primary-down" | "cloud-down" | "all-down" | "paused" | "unchecked";

/** One rules case: the rows to write, and the context that makes them fire. */
interface RulesCase {
  /** The rules to write, in `sort_order` order. */
  readonly rules: readonly { when: EscalationWhen; then: EscalationThen }[];
  /** What is known about the work, chosen so every rule above matches. */
  readonly context: ResolutionContext;
}

/**
 * The five rules cases — one per shape of thing a rule can do, plus the absence of any.
 *
 * `prepend` and `escalate` are both `use_alias` and are deliberately separate: the first names
 * an alias that is **not in the chain**, so the hop it adds has no stored `position`, and that
 * is the case the floor's semantics turn on. See the landmark case below.
 */
const RULES_CASES: Readonly<Record<RulesKey, RulesCase>> = {
  none: { rules: [], context: {} },
  escalate: {
    rules: [
      {
        when: { effort_gte: "l" },
        then: { use_alias: { task_kind: KIND, alias: "coder-max", params: { thinking: "max" } } },
      },
    ],
    context: { effort: "xl" },
  },
  prepend: {
    rules: [
      { when: { effort_gte: "l" }, then: { use_alias: { task_kind: KIND, alias: "local-fast" } } },
    ],
    context: { effort: "xl" },
  },
  vote: {
    rules: [
      {
        when: { label: "security" },
        then: { add_vote: { task_kind: KIND, alias: "second-opinion" } },
      },
    ],
    context: { labels: ["security"] },
  },
  local: {
    rules: [{ when: { diff_kind: "docs_only" }, then: { route_local: {} } }],
    context: { diffKind: "docs_only" },
  },
};

/**
 * The six health cases, as the status each connection's column holds.
 *
 * `unchecked` is the four rows exactly as the fixture seeds them — `unknown`, with no
 * `last_checked_at` and an empty `health`, which is what V015 requires of a row nothing has
 * looked at. It is in the matrix rather than beside it because *nobody has checked* has to
 * behave like a usable provider in **every** other dimension too, not only in the one test
 * that mentions it.
 */
const HEALTH_CASES: Readonly<
  Record<HealthKey, Readonly<Record<"anthropic" | "copilot" | "ollama" | "vllm", string>>>
> = {
  "all-active": { anthropic: "active", copilot: "active", ollama: "active", vllm: "active" },
  "primary-down": { anthropic: "error", copilot: "active", ollama: "active", vllm: "active" },
  "cloud-down": { anthropic: "error", copilot: "error", ollama: "active", vllm: "active" },
  "all-down": { anthropic: "error", copilot: "error", ollama: "error", vllm: "error" },
  paused: { anthropic: "paused", copilot: "active", ollama: "active", vllm: "active" },
  unchecked: { anthropic: "unknown", copilot: "unknown", ollama: "unknown", vllm: "unknown" },
};

/** The floors the matrix sweeps — off, and each of the three stored positions. */
const FLOORS: readonly (number | null)[] = [null, 1, 2, 3];

/** Mockup 06's **Allow fallback to local models** switch, both ways. */
const LOCAL_POLICIES: readonly boolean[] = [true, false];

/** The cost cap, absent and set — it is carried, never enforced here. */
const COST_CAPS: readonly (number | null)[] = [null, BENCH_MAX_COST_CENTS];

/** One cell of the matrix. */
interface MatrixCase {
  readonly rules: RulesKey;
  readonly health: HealthKey;
  readonly floor: number | null;
  readonly allowLocalFallback: boolean;
  readonly maxCostCents: number | null;
}

/** One cell, and what resolving it twice produced. */
interface MatrixOutcome {
  readonly cell: MatrixCase;
  /** How the cell reads in a failure message. */
  readonly label: string;
  /** The resolution. */
  readonly resolution: Resolution;
  /** The same question asked again — the determinism half. */
  readonly again: Resolution;
}

/**
 * A cell's key, and the sentence a failing assertion prints.
 *
 * @param cell - The cell.
 * @returns `rules=none health=cloud-down floor=2 local=on cost=250`.
 */
function labelOf(cell: MatrixCase): string {
  return [
    `rules=${cell.rules}`,
    `health=${cell.health}`,
    `floor=${cell.floor === null ? "off" : cell.floor.toString()}`,
    `local=${cell.allowLocalFallback ? "on" : "off"}`,
    `cost=${cell.maxCostCents === null ? "none" : cell.maxCostCents.toString()}`,
  ].join(" ");
}

/** The hop codes that keep a hop, as a set — the membership test every invariant shares. */
const KEPT = new Set<string>(KEPT_HOP_CODES);

/** Every hop code, for the closed-vocabulary assertion. */
const EVERY_HOP_CODE = new Set<string>(Object.values(HOP_CODES));

describe("the routing resolution matrix, against a migrated database", () => {
  let api: ApiHarness;
  let resolution: ResolutionService;
  let bench: RoutingBench;
  let ollama: ProviderStub;
  let vllm: ProviderStub;

  /** Every cell's answer, by {@link labelOf}. */
  const outcomes = new Map<string, MatrixOutcome>();

  beforeAll(async () => {
    // An hour between sweeps, so the application's own health loop cannot fire while the
    // matrix runs and turn the no-contact assertion into a race. The first delay is a full
    // jittered interval, so nothing is checked at boot either.
    api = await ApiHarness.start({ OURO_PROVIDER_HEALTH_INTERVAL_SECONDS: "3600" });
    resolution = api.nest.get(ResolutionService);

    ollama = await ProviderStub.start(() => ({ models: [{ name: "qwen3-coder:32b" }] }));
    vllm = await ProviderStub.start(() => ({ data: [{ id: "llama-4-maverick" }] }));

    bench = await seedRoutingBench(api, await api.signIn());

    // The two local connections are pointed at listening servers, so a resolution that issued
    // a request would be *answered* and recorded rather than failing quietly into a catch.
    await api.sql.query(
      `update ${SCHEMA_NAME}.provider_connections set base_url = case id
         when $2 then $3::text when $4 then $5::text else base_url end
       where organization_id = $1`,
      [bench.id, bench.connections.ollama, ollama.baseUrl, bench.connections.vllm, vllm.baseUrl],
    );

    await sweepTheMatrix();
  });

  afterAll(async () => {
    await api.truncate();
    await api.close();
    await ollama.stop();
    await vllm.stop();
  });

  /**
   * Resolve every cell, twice, and remember what came back.
   *
   * The loops are nested rules → health → floor → local → cost so that the two expensive
   * arrangements are written only when they change: a rules case is five statements and a
   * health case is four, while a policy is one `update`. Ordering the sweep this way is worth
   * roughly 3 000 statements the run does not issue.
   *
   * @returns When every cell has been resolved.
   */
  async function sweepTheMatrix(): Promise<void> {
    for (const rulesKey of Object.keys(RULES_CASES) as RulesKey[]) {
      await applyRules(rulesKey);

      for (const healthKey of Object.keys(HEALTH_CASES) as HealthKey[]) {
        await applyHealth(healthKey);

        for (const floor of FLOORS) {
          for (const allowLocalFallback of LOCAL_POLICIES) {
            for (const maxCostCents of COST_CAPS) {
              const cell: MatrixCase = {
                rules: rulesKey,
                health: healthKey,
                floor,
                allowLocalFallback,
                maxCostCents,
              };

              await setPolicy(api, bench.routes[KIND], {
                floorHopIndex: floor,
                allowLocalFallback,
                maxCostCentsPerRun: maxCostCents,
              });

              const context = RULES_CASES[rulesKey].context;
              const label = labelOf(cell);

              outcomes.set(label, {
                cell,
                label,
                resolution: await resolution.resolve(bench.id, KIND, context),
                again: await resolution.resolve(bench.id, KIND, context),
              });
            }
          }
        }
      }
    }
  }

  /**
   * Put one rules case's rows in place.
   *
   * @param key - Which case.
   * @returns When the workspace holds exactly that case's rules and no others.
   */
  async function applyRules(key: RulesKey): Promise<void> {
    await clearRules(api, bench.id);

    for (const [offset, rule] of RULES_CASES[key].rules.entries()) {
      await addRule(api, bench.id, { ...rule, sortOrder: offset + 1 });
    }
  }

  /**
   * Put one health case's statuses in place.
   *
   * @param key - Which case.
   * @returns When every connection's column says what the case says.
   */
  async function applyHealth(key: HealthKey): Promise<void> {
    for (const [connection, status] of Object.entries(HEALTH_CASES[key])) {
      await setHealth(
        api,
        bench.connections[connection],
        status as "active" | "paused" | "error" | "unknown",
        status === "unknown"
          ? {}
          : { latencyMs: 42, detail: status === "error" ? "503" : undefined },
      );
    }
  }

  /** Every cell's answer, in sweep order. */
  function everyOutcome(): MatrixOutcome[] {
    return [...outcomes.values()];
  }

  /**
   * One named cell, for a landmark assertion.
   *
   * @param cell - Which cell.
   * @returns What resolving it produced.
   * @throws {Error} When the matrix never swept that combination, which would mean a landmark
   *   case had quietly stopped being one of the cells the invariants cover.
   */
  function outcomeOf(cell: MatrixCase): MatrixOutcome {
    const outcome = outcomes.get(labelOf(cell));

    if (outcome === undefined) {
      throw new Error(`The matrix did not sweep ${labelOf(cell)}`);
    }

    return outcome;
  }

  /** The hops a resolution kept. */
  function kept(resolved: Resolution): readonly ResolutionHop[] {
    return resolved.chain.filter((hop) => hop.decision === "kept");
  }

  /**
   * Which of {@link HEALTH_CASES}' four connections a resolved provider is.
   *
   * The resolution carries the connection's **id**, and a health case is written in the
   * fixture's names, so one of the two has to be translated to compare them. Translating the
   * id is the direction that cannot go stale: the ids come from the rows the fixture actually
   * wrote.
   *
   * @param connectionId - From a hop's provider.
   * @returns The key {@link HEALTH_CASES} states that connection's status under.
   * @throws {Error} For an id the bench did not seed, which would mean the resolution reached
   *   a connection this suite does not control.
   */
  function connectionKeyOf(connectionId: string): "anthropic" | "copilot" | "ollama" | "vllm" {
    for (const key of ["anthropic", "copilot", "ollama", "vllm"] as const) {
      if (bench.connections[key] === connectionId) {
        return key;
      }
    }

    throw new Error(`The resolution named a connection the bench did not seed: ${connectionId}`);
  }

  describe("the sweep itself", () => {
    it("covers the whole cross product, and each cell exactly once", () => {
      const expected =
        Object.keys(RULES_CASES).length *
        Object.keys(HEALTH_CASES).length *
        FLOORS.length *
        LOCAL_POLICIES.length *
        COST_CAPS.length;

      expect(outcomes.size).toBe(expected);
      expect(expected).toBe(480);
    });

    it("answers every cell about the route it was asked about", () => {
      for (const { label, resolution: resolved } of everyOutcome()) {
        expect({ label, ...pick(resolved) }).toEqual({
          label,
          resolutionVersion: RESOLUTION_VERSION,
          taskKind: KIND,
          routeTag: "implement-primary",
        });
      }
    });

    it("answers identically when asked twice, byte for byte", () => {
      for (const { label, resolution: resolved, again } of everyOutcome()) {
        expect({ label, json: JSON.stringify(again) }).toEqual({
          label,
          json: JSON.stringify(resolved),
        });
      }
    });
  });

  describe("the floor, in every cell that has one", () => {
    it("is never crossed by a hop the resolution kept", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.floor === null) {
          continue;
        }

        const crossed = kept(resolved).filter(
          (hop) => hop.position !== null && hop.position > (cell.floor ?? 0),
        );

        expect({ label, crossed: crossed.map((hop) => hop.alias) }).toEqual({
          label,
          crossed: [],
        });
      }
    });

    it("refuses the run rather than returning the survivors it forbade", () => {
      for (const { label, resolution: resolved } of everyOutcome()) {
        if (resolved.floor.code !== FLOOR_CODES.breached) {
          continue;
        }

        expect({
          label,
          outcome: resolved.outcome,
          failure: resolved.failure?.code,
          kept: kept(resolved).length,
          below: resolved.chain.some((hop) => hop.code === HOP_CODES.belowFloor),
        }).toEqual({
          label,
          outcome: "fail_run",
          failure: RESOLUTION_FAILURE_CODES.floorBreached,
          kept: 0,
          below: true,
        });
      }
    });

    it("holds rather than breaches while anything above it survives", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.floor === null || kept(resolved).length === 0) {
          continue;
        }

        expect({ label, code: resolved.floor.code, index: resolved.floor.hopIndex }).toEqual({
          label,
          code: FLOOR_CODES.held,
          index: cell.floor,
        });
      }
    });

    it("says no floor, and blames nothing on one, where the switch is off", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.floor !== null) {
          continue;
        }

        expect({
          label,
          code: resolved.floor.code,
          index: resolved.floor.hopIndex,
          below: resolved.chain.filter((hop) => hop.code === HOP_CODES.belowFloor).length,
          failure: resolved.failure?.code ?? null,
        }).toEqual({
          label,
          code: FLOOR_CODES.none,
          index: null,
          below: 0,
          failure: kept(resolved).length === 0 ? RESOLUTION_FAILURE_CODES.noEligibleHop : null,
        });
      }
    });
  });

  describe("the local policies, in every cell", () => {
    it("keeps no local hop on a route that does not allow local models", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.allowLocalFallback) {
          continue;
        }

        const local = kept(resolved).filter(
          (hop) => hop.provider !== null && isLocalProvider(hop.provider.kind),
        );

        expect({ label, local: local.map((hop) => hop.alias) }).toEqual({ label, local: [] });
      }
    });

    it("keeps nothing but local hops once a route_local rule has fired", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.rules !== "local") {
          continue;
        }

        const cloud = kept(resolved).filter(
          (hop) => hop.provider !== null && !isLocalProvider(hop.provider.kind),
        );

        expect({ label, cloud: cloud.map((hop) => hop.alias) }).toEqual({ label, cloud: [] });
      }
    });

    it("blames the policy that actually excluded the hop", () => {
      // Both policies can exclude the same hop at once — a local hop on a route with local off
      // while a `route_local` rule fires — and `resolve.ts` reports the first that applies. The
      // claim here is narrower and is the one an operator depends on: a hop dropped for a
      // policy names a policy, never a provider that was working.
      const policyCodes = new Set<string>([HOP_CODES.notLocal, HOP_CODES.localNotAllowed]);

      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.allowLocalFallback && cell.rules !== "local") {
          continue;
        }

        for (const hop of resolved.chain) {
          if (!policyCodes.has(hop.code)) {
            continue;
          }

          const local = hop.provider !== null && isLocalProvider(hop.provider.kind);

          expect({ label, alias: hop.alias, code: hop.code }).toEqual({
            label,
            alias: hop.alias,
            code: local ? HOP_CODES.localNotAllowed : HOP_CODES.notLocal,
          });
        }
      }
    });
  });

  describe("health, in every cell", () => {
    it("never keeps a hop on a provider the column calls unusable", () => {
      for (const { label, resolution: resolved } of everyOutcome()) {
        for (const hop of kept(resolved)) {
          expect({ label, alias: hop.alias, status: hop.provider?.status }).toEqual({
            label,
            alias: hop.alias,
            status: hop.provider?.status === "unknown" ? "unknown" : "active",
          });
        }
      }
    });

    it("keeps a hop nobody has checked, because unchecked is not down", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        if (cell.health !== "unchecked") {
          continue;
        }

        for (const hop of resolved.chain) {
          if (hop.provider === null) {
            continue;
          }

          expect({ label, alias: hop.alias, status: hop.provider.status }).toEqual({
            label,
            alias: hop.alias,
            status: "unknown",
          });

          // Never 0 as a stand-in: a provider nothing has called has no latency, and `0ms` is
          // an excellent latency for a machine that is switched off.
          expect(hop.provider.latencyMs).toBeNull();
        }
      }
    });

    it("drops a paused provider as paused, and an unreachable one as unreachable", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        const statuses = HEALTH_CASES[cell.health];

        for (const hop of resolved.chain) {
          // A hop excluded by a policy is reported as that policy — see `resolve.ts` on why
          // the order is a product decision — so only the hops that reached the health test
          // are the health test's to explain.
          if (
            hop.provider === null ||
            (hop.code !== HOP_CODES.paused && hop.code !== HOP_CODES.unreachable)
          ) {
            continue;
          }

          const status = statuses[connectionKeyOf(hop.provider.id)];

          expect({ label, alias: hop.alias, code: hop.code }).toEqual({
            label,
            alias: hop.alias,
            code: status === "paused" ? HOP_CODES.paused : HOP_CODES.unreachable,
          });
        }
      }
    });
  });

  describe("what every answer carries", () => {
    it("reports resolved exactly when something survived", () => {
      for (const { label, resolution: resolved } of everyOutcome()) {
        const usable = kept(resolved).length > 0;

        expect({
          label,
          outcome: resolved.outcome,
          failure: resolved.failure === null,
        }).toEqual({
          label,
          outcome: usable ? "resolved" : "fail_run",
          failure: usable,
        });
      }
    });

    it("explains every hop, with a code from the closed set", () => {
      for (const { label, resolution: resolved } of everyOutcome()) {
        for (const [offset, hop] of resolved.chain.entries()) {
          expect({
            label,
            index: hop.index,
            known: EVERY_HOP_CODE.has(hop.code),
            decision: hop.decision,
            explained: hop.explanation.length > 0,
          }).toEqual({
            label,
            index: offset + 1,
            known: true,
            decision: KEPT.has(hop.code) ? "kept" : "dropped",
            explained: true,
          });
        }
      }
    });

    it("explains every refusal", () => {
      for (const { label, resolution: resolved } of everyOutcome()) {
        if (resolved.failure === null) {
          continue;
        }

        expect({ label, explained: resolved.failure.explanation.length > 0 }).toEqual({
          label,
          explained: true,
        });
      }
    });

    it("carries the route's cost cap and local switch through untouched", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        expect({
          label,
          cap: resolved.maxCostCents,
          local: resolved.allowLocalFallback,
        }).toEqual({
          label,
          cap: cell.maxCostCents,
          local: cell.allowLocalFallback,
        });
      }
    });

    it("evaluates the workspace's rules and no others, in the sentence the database wrote", () => {
      for (const { label, cell, resolution: resolved } of everyOutcome()) {
        expect({ label, rules: resolved.rules.length }).toEqual({
          label,
          rules: RULES_CASES[cell.rules].rules.length,
        });

        for (const rule of resolved.rules) {
          expect({ label, display: rule.display.length > 0 }).toEqual({ label, display: true });
        }
      }
    });
  });

  describe("the landmarks the invariants are read against", () => {
    it("refuses a run with every provider down, and blames no floor for it", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "none",
        health: "all-down",
        floor: null,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(resolved.outcome).toBe("fail_run");
      expect(resolved.failure?.code).toBe(RESOLUTION_FAILURE_CODES.noEligibleHop);
      expect(resolved.floor.code).toBe(FLOOR_CODES.none);
      expect(resolved.chain.map((hop) => hop.code)).toEqual([
        HOP_CODES.unreachable,
        HOP_CODES.unreachable,
        HOP_CODES.unreachable,
      ]);
    });

    it("refuses rather than degrading past the floor an operator set", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "none",
        health: "cloud-down",
        floor: 2,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(resolved.outcome).toBe("fail_run");
      expect(resolved.failure?.code).toBe(RESOLUTION_FAILURE_CODES.floorBreached);
      expect(resolved.chain.map((hop) => hop.code)).toEqual([
        HOP_CODES.unreachable,
        HOP_CODES.unreachable,
        HOP_CODES.belowFloor,
      ]);
    });

    it("degrades to the deepest hop the floor does allow", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "none",
        health: "cloud-down",
        floor: 3,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(resolved.outcome).toBe("resolved");
      expect(resolved.floor.code).toBe(FLOOR_CODES.held);
      expect(kept(resolved).map((hop) => hop.alias)).toEqual(["local-docs"]);
    });

    it("has nothing left, and says so without mentioning a floor, when local is off", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "none",
        health: "cloud-down",
        floor: null,
        allowLocalFallback: false,
        maxCostCents: null,
      });

      expect(resolved.outcome).toBe("fail_run");
      expect(resolved.failure?.code).toBe(RESOLUTION_FAILURE_CODES.noEligibleHop);
      expect(resolved.chain[2].code).toBe(HOP_CODES.localNotAllowed);
    });

    it("leaves a prepended hop above the floor, because it has no position to be below it", () => {
      // The floor is measured against `route_hops.position`, never against the resolved index
      // — an operator set *"fail below fallback 2"* while looking at the stored chain. A rule
      // that prepends a primary must not quietly make that policy one hop shallower.
      const { resolution: resolved } = outcomeOf({
        rules: "prepend",
        health: "all-active",
        floor: 1,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(resolved.chain).toHaveLength(4);
      expect(resolved.chain[0]).toMatchObject({
        index: 1,
        position: null,
        alias: "local-fast",
        decision: "kept",
      });
      expect(kept(resolved).map((hop) => hop.alias)).toEqual(["local-fast", "coder-max"]);
      expect(resolved.chain[3].code).toBe(HOP_CODES.belowFloor);
    });

    it("merges a rule's params over the alias's own, on the primary the rule names", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "escalate",
        health: "all-active",
        floor: null,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(resolved.chain).toHaveLength(3);
      expect(resolved.chain[0]).toMatchObject({ alias: "coder-max", params: { thinking: "max" } });
    });

    it("attaches the second opinion a rule asked for, naming the rule that asked", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "vote",
        health: "all-active",
        floor: null,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(resolved.votes).toHaveLength(1);
      expect(resolved.votes[0]).toMatchObject({
        alias: "second-opinion",
        modelId: "claude-sonnet-5",
      });
      expect(resolved.votes[0].ruleId).toBe(resolved.rules[0].id);
    });

    it("filters the chain to local providers when a docs-only diff routes everything local", () => {
      const { resolution: resolved } = outcomeOf({
        rules: "local",
        health: "all-active",
        floor: null,
        allowLocalFallback: true,
        maxCostCents: BENCH_MAX_COST_CENTS,
      });

      expect(kept(resolved).map((hop) => hop.alias)).toEqual(["local-docs"]);
      expect(resolved.chain.slice(0, 2).map((hop) => hop.code)).toEqual([
        HOP_CODES.notLocal,
        HOP_CODES.notLocal,
      ]);
    });
  });

  describe("what resolving never does", () => {
    it("contacts no provider, over the whole matrix", () => {
      // 480 cells, each resolved twice, with two providers listening on loopback the whole
      // time — and neither of them was asked anything. Z.3 is passive-first by design, and
      // this is that promise from routing's side.
      expect({ ollama: ollama.received, vllm: vllm.received }).toEqual({ ollama: [], vllm: [] });
    });
  });
});

/**
 * The three fields every answer must stamp, whatever else it decided.
 *
 * @param resolved - The resolution.
 * @returns Its version, kind and tag.
 */
function pick(
  resolved: Resolution,
): Pick<Resolution, "resolutionVersion" | "taskKind" | "routeTag"> {
  return {
    resolutionVersion: resolved.resolutionVersion,
    taskKind: resolved.taskKind,
    routeTag: resolved.routeTag,
  };
}
