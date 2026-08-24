import type { ProviderHealthService } from "../provider-health/provider-health.service";
import { ResolutionService } from "./resolution.service";
import { ROUTING_ERRORS } from "./routing.errors";
import type { RoutingRepository } from "./routing.repository";
import { CONNECTIONS, HEALTH } from "./routing.fixture";
import type { AliasRow, ChainHopRow, EscalationRuleRow, RouteRow } from "./routing.rows";

/**
 * The load, and only the load.
 *
 * Everything this class decides is in `resolve.ts`, which `resolve.spec.ts` drives directly
 * over a matrix of inputs. What is left here is worth three questions, and they are the three
 * a mocked repository can actually answer:
 *
 *   * **is the workspace carried into every read**, so one member's resolution cannot be
 *     computed from another workspace's rules;
 *   * **is a missing route the one thing that is an error** rather than an answer; and
 *   * **does health arrive from Z.3's service**, rather than from a check performed here or
 *     from a column selected beside the chain.
 */

/** `implement-primary`, as the seed writes it. */
const ROUTE: RouteRow = {
  route_id: "5eed0011-0000-4000-8000-000000000004",
  tag: "implement-primary",
  allow_local_fallback: true,
  floor_hop_index: null,
  max_cost_cents_per_run: 250,
};

/** One hop of it. */
const HOPS: ChainHopRow[] = [
  {
    position: 1,
    note: null,
    alias: "coder-max",
    model_id: "claude-fable-5",
    params: {},
    connection_id: CONNECTIONS.anthropic,
    kind: "anthropic",
    display_name: "Anthropic Claude",
    base_url: null,
  },
];

/** The workspace's aliases — here, just the one the chain names. */
const ALIAS_ROWS: AliasRow[] = HOPS.map(({ position: _position, note: _note, ...alias }) => alias);

/** The effort rule, as the row it is stored as. */
const RULE_ROWS: EscalationRuleRow[] = [
  {
    id: "5eed0013-0000-4000-8000-000000000001",
    sort_order: 1,
    display: "effort ≥ L → implement uses coder-max (max thinking)",
    when: { effort_gte: "l" },
    then: {
      use_alias: { task_kind: "implement", alias: "coder-max", params: { thinking: "max" } },
    },
  },
];

const WORKSPACE = "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10";

/**
 * A repository that answers with the rows above, and remembers what it was asked.
 *
 * `null` rather than `undefined` for *this workspace has no such route*: passing `undefined`
 * to a parameter with a default is passing nothing, which would silently give a test the
 * route it was written to do without.
 */
function repository(route: RouteRow | null = ROUTE) {
  return {
    route: jest.fn().mockResolvedValue(route ?? undefined),
    hops: jest.fn().mockResolvedValue(HOPS),
    aliases: jest.fn().mockResolvedValue(ALIAS_ROWS),
    rules: jest.fn().mockResolvedValue(RULE_ROWS),
  } as unknown as jest.Mocked<RoutingRepository>;
}

/** Z.3's service, reduced to the one method this module is allowed to call. */
function health() {
  return {
    snapshots: jest.fn().mockResolvedValue(HEALTH),
    sweep: jest.fn(),
    strip: jest.fn(),
  } as unknown as jest.Mocked<ProviderHealthService>;
}

describe("resolving through the service", () => {
  it("answers with the chain the pure function computed", async () => {
    const service = new ResolutionService(repository(), health());

    const resolution = await service.resolve(WORKSPACE, "implement");

    expect(resolution.outcome).toBe("resolved");
    expect(resolution.routeTag).toBe("implement-primary");
    expect(resolution.taskKind).toBe("implement");
    expect(resolution.maxCostCents).toBe(250);
    expect(resolution.chain.map((hop) => hop.alias)).toEqual(["coder-max"]);
  });

  it("passes the context through to the rules", async () => {
    const service = new ResolutionService(repository(), health());

    const resolution = await service.resolve(WORKSPACE, "implement", { effort: "l" });

    expect(resolution.rules).toHaveLength(1);
    expect(resolution.chain[0].params).toEqual({ thinking: "max" });
  });

  it("treats no context as a legitimate question rather than a missing argument", async () => {
    // `{}` means *no escalation rule fires*, not *every rule fires* — see `context.ts`.
    const service = new ResolutionService(repository(), health());

    expect((await service.resolve(WORKSPACE, "implement")).rules).toEqual([]);
  });

  it("carries the workspace into every read", async () => {
    const routes = repository();
    const service = new ResolutionService(routes, health());

    await service.resolve(WORKSPACE, "implement");

    expect(routes.route).toHaveBeenCalledWith(WORKSPACE, "implement");
    expect(routes.hops).toHaveBeenCalledWith(WORKSPACE, ROUTE.route_id);
    expect(routes.aliases).toHaveBeenCalledWith(WORKSPACE);
    expect(routes.rules).toHaveBeenCalledWith(WORKSPACE);
  });

  it("takes health from Z.3's snapshots and asks it to check nothing", async () => {
    // The pure-inputs rule, at the seam where it could be broken. A resolution that swept
    // would put an outbound request on the path of every routing decision, and would still be
    // reading a number that was true a moment ago.
    const providers = health();
    const service = new ResolutionService(repository(), providers);

    await service.resolve(WORKSPACE, "implement");

    expect(providers.snapshots).toHaveBeenCalledWith(WORKSPACE);
    expect(providers.sweep).not.toHaveBeenCalled();
  });

  it("refuses a task kind this workspace does not route", async () => {
    const service = new ResolutionService(repository(null), health());

    await expect(service.resolve(WORKSPACE, "triage")).rejects.toMatchObject({
      response: { code: ROUTING_ERRORS.routeNotFound, details: { taskKind: "triage" } },
    });
  });

  it("reads nothing else once the route is missing", async () => {
    // The route is read first precisely so its absence decides the error. Loading a
    // workspace's aliases and rules for a kind it does not route would be four round trips
    // spent on an answer already known.
    const routes = repository(null);
    const service = new ResolutionService(routes, health());

    await expect(service.resolve(WORKSPACE, "triage")).rejects.toThrow();

    expect(routes.hops).not.toHaveBeenCalled();
    expect(routes.aliases).not.toHaveBeenCalled();
    expect(routes.rules).not.toHaveBeenCalled();
  });

  it("answers a route whose providers are all down, rather than throwing", async () => {
    // A `fail_run` is a successful answer carrying a reason. Turning it into an exception
    // would throw away the explanation an operator needs.
    const providers = health();
    providers.snapshots.mockResolvedValue([
      { ...HEALTH[0], connectionId: CONNECTIONS.anthropic, status: "error" },
    ]);

    const resolution = await new ResolutionService(repository(), providers).resolve(
      WORKSPACE,
      "implement",
    );

    expect(resolution.outcome).toBe("fail_run");
    expect(resolution.failure?.code).toBe("no_eligible_hop");
    expect(resolution.maxCostCents).toBe(250);
  });
});
