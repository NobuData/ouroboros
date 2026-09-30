import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { STUB_BASE_URL, clientAnswering } from "../helpers/api";
import { seededFact, seededFacts } from "../helpers/knowledge";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { facts } = await import("@/app/api/facts");

/**
 * The facts facade (#419): the list, the manual proposal, and the five edges of decision K3 —
 * each one call by id, naming no workspace, answering the fact as the service now holds it.
 */

const FACT = seededFact("Team");

describe("facts.list", () => {
  it("lists every fact with the counts, naming no workspace", async () => {
    const { client, requests } = clientAnswering(seededFacts());

    expect(await facts.list(client)).toEqual(seededFacts());
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/facts`);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.headers.get("x-ouro-tenant")).toBeNull();
  });
});

describe("facts.propose", () => {
  it("posts the body and answers the new proposal", async () => {
    const { client, requests } = clientAnswering(FACT, 201);
    const body = { text: "A fact", anchors: [{ kind: "dependency" as const, value: "west" }] };

    expect(await facts.propose(body, client)).toEqual(FACT);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/facts`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(body);
  });
});

describe("the transitions", () => {
  it.each([
    ["confirm", "confirm", {}],
    ["reject", "reject", { reason: "duplicate" }],
    ["reconfirm", "reconfirm", {}],
  ] as const)("%s posts to its edge with the optional note", async (name, segment, body) => {
    const { client, requests } = clientAnswering({ ...FACT, status: "confirmed" });

    expect(await facts[name](FACT.id, body, client)).toEqual({ ...FACT, status: "confirmed" });
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/facts/${FACT.id}/${segment}`);
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual(body);
  });

  it("sends an empty note when none is given", async () => {
    const { client, requests } = clientAnswering(FACT);

    await facts.confirm(FACT.id, undefined, client);

    expect(await requests[0]?.json()).toEqual({});
  });

  it("expires with its reason", async () => {
    const { client, requests } = clientAnswering({ ...FACT, status: "expired" });

    await facts.expire(FACT.id, { reason: "Zephyr 4.1 migration" }, client);

    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/facts/${FACT.id}/expire`);
    expect(await requests[0]?.json()).toEqual({ reason: "Zephyr 4.1 migration" });
  });

  it("re-learns into a new proposal", async () => {
    const fresh = { ...FACT, id: "5eed0044-0000-4000-8000-000000000009", relearnedFromFactId: FACT.id };
    const { client, requests } = clientAnswering(fresh, 201);

    expect(await facts.relearn(FACT.id, {}, client)).toEqual(fresh);
    expect(requests[0]?.url).toBe(`${STUB_BASE_URL}/api/v1/facts/${FACT.id}/relearn`);
  });

  it("answers a refused edge as the service's error, edge and all", async () => {
    const { client } = clientAnswering(
      { code: "fact_transition_refused", message: "A rejected fact cannot be confirmed.", details: { from: "rejected", to: "confirmed" } },
      409,
    );

    const error = await facts.confirm(FACT.id, {}, client).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "fact_transition_refused", details: { from: "rejected", to: "confirmed" } });
  });
});
