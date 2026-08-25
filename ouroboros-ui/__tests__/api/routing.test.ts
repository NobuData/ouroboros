import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
// Types only, so this import is erased and nothing loads before the mocks below.
import type { ProviderHealthStrip, RoutingMatrix } from "@/app/api/routing";

import { clientAnswering, stubClient } from "../helpers/api";
import {
  emptyMatrix,
  failRunExample,
  resolvedExample,
  seededAliases,
  seededMatrix,
  seededProviders,
  seededRules,
  stripPayload,
  unmeasuredMatrix,
} from "../helpers/models";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { routing } = await import("@/app/api/routing");

/**
 * The routing page's two reads — the provider health strip (#196, consumed by #200) and the
 * matrix (#195/#198, consumed by #201).
 *
 * Two `GET`s with no parameters, so most of what is worth holding is about what this module
 * does *not* do — it names no workspace, it triggers no check, it makes no second request for
 * a card the first one already carried, and it hands back what the service composed rather
 * than recomposing it — and about the one property the whole page's honesty rests on: **an
 * absent measurement survives the crossing as `null`.**
 */

/** The refusal a screen behind the gate can still meet: a session acting in no workspace. */
const NO_ORGANIZATION = {
  code: "organization_required",
  message: "Choose a workspace before opening model routing.",
  details: {},
};

describe("routing.providers", () => {
  it("calls the strip endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(stripPayload());

    const payload = await routing.providers(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing/providers");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(stripPayload());
  });

  it("reads the strip in one request and asks for nothing else", async () => {
    const { client, requests } = clientAnswering(stripPayload());

    await routing.providers(client);

    expect(requests).toHaveLength(1);
  });

  it("triggers no check — the only verb it uses is GET", async () => {
    // A *check now* button would let anybody holding a session make `ouroboros-rest` issue
    // outbound requests at whatever rate they can click, against a vendor's rate limit and
    // signed with the workspace's own credential. The cadence is the service's scheduler's.
    const { client, requests } = clientAnswering(stripPayload());

    await routing.providers(client);

    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    // Every operation this module publishes. The three rule writes are the rules card's
    // (#204) and address `/routing/rules`; the batch save is chain editing's (#202) and
    // addresses `/routing/routes`; none of them, and no read, touches the providers path
    // with anything but GET.
    // …and the simulate question (#203) is a `POST` that creates nothing, at `/routing/simulate`.
    expect(Object.keys(routing)).toEqual([
      "providers",
      "matrix",
      "aliases",
      "saveRoutes",
      "addRule",
      "changeRule",
      "removeRule",
      "simulate",
    ]);
  });

  it("names no workspace, because the session's active organization is the scope", async () => {
    // There is no workspace in this path and this application sends no `X-Ouro-Tenant`
    // override (`app/api/server.ts`). A header here would be a second opinion about tenancy.
    const { client, requests } = clientAnswering(stripPayload());

    await routing.providers(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    expect(new URL(requests[0]!.url).search).toBe("");
  });

  it("reads a workspace with no providers as an empty strip rather than a failure", async () => {
    // The page's empty state. A workspace part-way through setting itself up has connected
    // nothing, and that is a state the product guides out of rather than an error.
    const { client } = clientAnswering(stripPayload([]));

    const payload = await routing.providers(client);

    expect(payload.providers).toEqual([]);
  });

  it("carries an absent measurement across as null rather than as a number", async () => {
    // The property the whole strip's honesty rests on, asserted at the boundary it could be
    // lost at. `0ms` is an excellent latency for a provider nothing has ever called, so a
    // client that supplied one here would be inventing the product's one claim about the
    // outside world.
    const { client } = clientAnswering(stripPayload(seededProviders()));

    const payload = await routing.providers(client);
    const cursor = payload.providers.find((row) => row.displayName === "Cursor");

    expect(cursor?.latencyMs).toBeNull();
    expect(cursor?.models).toBeNull();
    expect(cursor?.meta).toBeNull();
    expect(cursor?.checkedAt).not.toBeNull();
  });

  it("rejects with the service's envelope rather than swallowing it", async () => {
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught: unknown = await routing.providers(client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("organization_required");
    expect((caught as ApiError).status).toBe(400);
  });

  it("carries a message written for a person, naming nothing about the service", async () => {
    // It reaches the strip's place on the page as the reason it is empty, so it is read by
    // whoever opened the page.
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught = (await routing.providers(client).catch((e: unknown) => e)) as ApiError;

    expect(caught.message).toBe(NO_ORGANIZATION.message);
    expect(caught.message).not.toMatch(/http|:\d{2,5}|ECONN|select /i);
  });
});

describe("routing.matrix", () => {
  it("calls the routing endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(seededMatrix());

    const payload = await routing.matrix(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(seededMatrix());
  });

  it("reads the matrix, the rules and the spend card in one request", async () => {
    // A correctness property rather than an economy. The escalation column and the rules card
    // render the same rows, and the matrix's `$/run avg` and the card's totals are aggregates
    // over the same ledger — fetched apart they would be aggregates at two instants.
    const { client, requests } = clientAnswering(seededMatrix());

    const payload = await routing.matrix(client);

    expect(requests).toHaveLength(1);
    expect(payload.taskKinds).toHaveLength(8);
    expect(payload.rules).toHaveLength(3);
    expect(payload.spend).toBeDefined();
  });

  it("names no workspace, because the session's active organization is the scope", async () => {
    const { client, requests } = clientAnswering(seededMatrix());

    await routing.matrix(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    expect(new URL(requests[0]!.url).search).toBe("");
  });

  it("reads an unseeded workspace as empty arrays rather than as a failure", async () => {
    // *Nobody has configured this* is a state the product guides out of (AA.6, #205), not an
    // error — and the page says something different for it than for a refused read.
    const { client } = clientAnswering(emptyMatrix());

    const payload = await routing.matrix(client);

    expect(payload.taskKinds).toEqual([]);
    expect(payload.rules).toEqual([]);
  });

  it("carries an unmeasured figure across as null rather than as a zero", async () => {
    // Decision M7, asserted at the boundary it could be lost at. A workspace that has run
    // nothing has not spent `$0.00` per run, and `0ms` is not a latency anybody timed.
    const { client } = clientAnswering(unmeasuredMatrix());

    const payload = await routing.matrix(client);

    expect(payload.taskKinds[0]?.route?.stats.costCentsPerRunAvg).toBeNull();
    expect(payload.taskKinds[0]?.route?.stats.latencyP50Ms).toBeNull();
  });

  it("rejects with the service's envelope rather than swallowing it", async () => {
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    const caught: unknown = await routing.matrix(client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("organization_required");
  });
});

describe("the typing, which is the reason the client is generated", () => {
  it("types the strip end to end", async () => {
    const { client } = clientAnswering(stripPayload());

    const payload: ProviderHealthStrip = await routing.providers(client);

    expect(payload.providers).toHaveLength(5);
    expect(payload.providers[0]?.latencyMs).toBe(42);
  });

  it("types the matrix end to end", async () => {
    const { client } = clientAnswering(seededMatrix());

    const payload: RoutingMatrix = await routing.matrix(client);

    expect(payload.taskKinds[3]?.name).toBe("implement");
    expect(payload.taskKinds[3]?.route?.hops).toHaveLength(3);
    expect(payload.rules[0]?.display).toContain("coder-max");
  });

  it("holds a chip to the twelve fields the strip draws from", () => {
    // A thirteenth would be a fact nobody rendered; a missing one is a compile error in
    // `app/models/view.ts` rather than an `undefined` printed on a chip. `errorClass` joined
    // with AE.4 (#230): the class a test wrote, which the provider card's pill reads.
    expect(Object.keys(seededProviders()[0]!).sort()).toEqual([
      "check",
      "checkedAt",
      "detail",
      "displayName",
      "errorClass",
      "host",
      "id",
      "kind",
      "latencyMs",
      "meta",
      "models",
      "status",
    ]);
  });
});

/* ------------------------------------------------------------------ the rules card's calls (#204) */

/** The seed's first rule, as a write would send it: structure, and no sentence. */
const NEW_RULE = { when: seededRules()[0].when, then: seededRules()[0].then };

/** The refusal a member meets on every write. */
const FORBIDDEN = {
  code: "forbidden",
  message: "Your role does not permit changing escalation rules.",
  details: {},
};

describe("routing.aliases", () => {
  it("reads the registry list and returns the aliases themselves, unbound ones included", async () => {
    const { client, requests } = clientAnswering({ aliases: seededAliases() });

    const aliases = await routing.aliases(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing/aliases");
    expect(requests[0]?.method).toBe("GET");
    expect(aliases).toEqual(seededAliases());
    // The builder offers a name created ahead of its key, and the resolution line is what
    // says so — dropping it here would hide an alias a rule may legitimately name.
    expect(aliases.find((alias) => alias.alias === "gpt5-experiments")?.provider).toBeNull();
  });
});

describe("routing.addRule", () => {
  it("POSTs the structure to the rules collection, and sends no sentence", async () => {
    const { client, requests } = clientAnswering(seededRules()[0], 201);

    await routing.addRule(NEW_RULE, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing/rules");
    expect(requests[0]?.method).toBe("POST");

    const body: unknown = await requests[0]!.json();

    // `when` and `then` and nothing else: no `display`, which the contract refuses, and no
    // `sortOrder`, so the rule is appended rather than claiming a position.
    expect(body).toEqual(NEW_RULE);
    expect(Object.keys(body as object)).toEqual(["when", "then"]);
  });

  it("returns the rule the service wrote, carrying the sentence it derived", async () => {
    const { client } = clientAnswering(seededRules()[0], 201);

    const rule = await routing.addRule(NEW_RULE, client);

    expect(rule.display).toBe("effort ≥ L → implement uses coder-max (max thinking)");
  });

  it("rejects with the service's envelope for a role that may not write", async () => {
    const { client } = clientAnswering(FORBIDDEN, 403);

    const caught: unknown = await routing.addRule(NEW_RULE, client).catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("forbidden");
    expect((caught as ApiError).status).toBe(403);
  });
});

describe("routing.changeRule", () => {
  it("PATCHes the one rule, with only what changes", async () => {
    const rule = seededRules()[1];
    const { client, requests } = clientAnswering({ ...rule, enabled: false });

    const answer = await routing.changeRule(rule.id, { enabled: false }, client);

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/routing/rules/${rule.id}`);
    expect(requests[0]?.method).toBe("PATCH");
    // The switch never resends a predicate it has no intention of changing.
    expect(await requests[0]!.json()).toEqual({ enabled: false });
    expect(answer.enabled).toBe(false);
    expect(answer.display).toBe(rule.display);
  });

  it("rejects with the service's envelope for a rule that no longer exists", async () => {
    const { client } = clientAnswering(
      { code: "escalation_rule_not_found", message: "No such rule.", details: {} },
      404,
    );

    const caught: unknown = await routing
      .changeRule(seededRules()[0].id, { enabled: true }, client)
      .catch((e: unknown) => e);

    expect((caught as ApiError).code).toBe("escalation_rule_not_found");
  });
});

describe("routing.removeRule", () => {
  it("DELETEs the one rule and resolves to nothing on the contract's 204", async () => {
    const rule = seededRules()[2];
    // A `204` has no body; the stub answers with none, which is what the contract does.
    const { client, requests } = stubClient(() => ({ body: undefined, status: 204 }));

    await expect(routing.removeRule(rule.id, client)).resolves.toBeUndefined();

    expect(requests[0]?.url).toBe(`http://rest.test:4000/api/v1/routing/rules/${rule.id}`);
    expect(requests[0]?.method).toBe("DELETE");
  });

  it("rejects with the service's envelope for a role that may not remove", async () => {
    const { client } = clientAnswering(FORBIDDEN, 403);

    const caught: unknown = await routing
      .removeRule(seededRules()[0].id, client)
      .catch((e: unknown) => e);

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("forbidden");
  });
});

/* ------------------------------------------------------------------ Save routes (#202) */

/** The seeded `implement` route as a batch entry: the chain reversed, the policy unchanged. */
const IMPLEMENT_ENTRY = {
  taskKind: "implement",
  hops: [
    { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
    { alias: "coder-max", note: null },
    { alias: "local-docs", note: "Offline mode — keeps the loop turning without a network" },
  ],
  allowLocalFallback: true,
  floorHopIndex: null,
  maxCostCentsPerRun: 250,
};

/** What the contract answers a save with: the revision, and the route as re-read. */
const SAVED = {
  revisionId: "a1000000-0000-4000-8000-000000000001",
  routes: [seededMatrix().taskKinds[3].route],
};

/** The contract's refusal, keyed by task kind — `details.routes`. */
const REFUSED = {
  code: "route_save_invalid",
  message: "These routes could not be saved. See `details.routes` for each one. Nothing was saved.",
  details: {
    routes: { implement: { "hops.1.alias": ['This workspace has no model alias named "coder-max".'] } },
  },
};

describe("routing.saveRoutes", () => {
  it("PUTs the batch to the routes collection, as one object with one array", async () => {
    const { client, requests } = clientAnswering(SAVED);

    await routing.saveRoutes([IMPLEMENT_ENTRY], client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing/routes");
    expect(requests[0]?.method).toBe("PUT");
    expect(await requests[0]!.json()).toEqual({ routes: [IMPLEMENT_ENTRY] });
  });

  it("sends the chain as an array with no positions, and never a raw model id", async () => {
    // The contract numbers hops densely from 1 in the order sent; a position in the body
    // would be a second opinion about order, and a model id a route may not name (M1).
    const { client, requests } = clientAnswering(SAVED);

    await routing.saveRoutes([IMPLEMENT_ENTRY], client);

    const body = (await requests[0]!.json()) as { routes: { hops: Record<string, unknown>[] }[] };

    for (const hop of body.routes[0].hops) {
      expect(Object.keys(hop).sort()).toEqual(["alias", "note"]);
    }
  });

  it("returns the revision and the routes as the server re-read them", async () => {
    const { client } = clientAnswering(SAVED);

    const result = await routing.saveRoutes([IMPLEMENT_ENTRY], client);

    expect(result.revisionId).toBe(SAVED.revisionId);
    expect(result.routes[0]?.taskKind).toBe("implement");
  });

  it("names no workspace, because the session's active organization is the scope", async () => {
    const { client, requests } = clientAnswering(SAVED);

    await routing.saveRoutes([IMPLEMENT_ENTRY], client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("rejects with the envelope, keeping `details.routes` for the matrix to mark rows from", async () => {
    // The whole point of the contract keying its refusal by task kind: the client does not
    // have to work out which of eight routes was refused.
    const { client } = clientAnswering(REFUSED, 422);

    const caught = (await routing.saveRoutes([IMPLEMENT_ENTRY], client).catch((e: unknown) => e)) as ApiError;

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught.status).toBe(422);
    expect(caught.code).toBe("route_save_invalid");
    expect(caught.details).toEqual(REFUSED.details);
  });

  it("rejects with the service's envelope for a role that may not write", async () => {
    const { client } = clientAnswering(FORBIDDEN, 403);

    const caught: unknown = await routing.saveRoutes([IMPLEMENT_ENTRY], client).catch((e: unknown) => e);

    expect((caught as ApiError).code).toBe("forbidden");
  });
});

describe("routing.simulate", () => {
  it("POSTs the question to the simulate endpoint and returns the resolution itself", async () => {
    const { client, requests } = clientAnswering(resolvedExample());
    const request = { taskKind: "review", ctx: { labels: ["security"] } };

    const resolution = await routing.simulate(request, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/routing/simulate");
    expect(requests[0]?.method).toBe("POST");
    await expect(requests[0]?.json()).resolves.toEqual(request);
    expect(resolution).toEqual(resolvedExample());
  });

  it("sends a kind alone when nothing is known — no ctx, and never a null fact", async () => {
    const { client, requests } = clientAnswering(resolvedExample());

    await routing.simulate({ taskKind: "docs" }, client);

    await expect(requests[0]?.json()).resolves.toEqual({ taskKind: "docs" });
  });

  it("resolves — never rejects — with a fail_run, which is an answer on a 200", async () => {
    const { client } = clientAnswering(failRunExample());

    const resolution = await routing.simulate({ taskKind: "implement" }, client);

    expect(resolution.outcome).toBe("fail_run");
    expect(resolution.failure?.code).toBe("floor_breached");
  });

  it("names no workspace, because the session's active organization is the scope", async () => {
    const { client, requests } = clientAnswering(resolvedExample());

    await routing.simulate({ taskKind: "review" }, client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    await expect(requests[0]?.json()).resolves.not.toHaveProperty("organizationId");
  });

  it("rejects with the service's envelope for a kind with no route to explain", async () => {
    const { client } = clientAnswering(
      { code: "route_not_found", message: "This workspace has no route for deploy.", details: { taskKind: "deploy" } },
      404,
    );

    await expect(routing.simulate({ taskKind: "deploy" }, client)).rejects.toMatchObject({
      status: 404,
      code: "route_not_found",
      message: "This workspace has no route for deploy.",
    });
  });
});
