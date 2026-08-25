import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering, stubClient } from "../helpers/api";
import { registryAlias, registryPayload, seededRegistry } from "../helpers/registry";
import { modelAlias } from "../helpers/providers";

// The facade sits on the server-side client — see `server.test.ts` for what each of these
// three answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const { registry } = await import("@/app/api/registry");

/**
 * The registry page's read (#588, consumed by #592) and the table's one write (#584).
 *
 * A `GET` with no parameters and a `PATCH` with one field, so most of what is worth holding
 * is about what this module does *not* do — it names no workspace, it makes one request for
 * a table five subsystems compose, it hands back what the service composed rather than
 * recomposing it, and the switch sends the position asked for and nothing else.
 */

/** The refusal a screen behind the gate can still meet: a session acting in no workspace. */
const NO_ORGANIZATION = {
  code: "organization_required",
  message: "Choose a workspace before opening the registry.",
  details: {},
};

describe("registry.read", () => {
  it("calls the composed endpoint and returns the body itself", async () => {
    const { client, requests } = clientAnswering(registryPayload());

    const payload = await registry.read(client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/registry");
    expect(requests[0]?.method).toBe("GET");
    expect(payload).toEqual(registryPayload());
  });

  it("reads the table in one request and asks for nothing else", async () => {
    // Eight columns from five subsystems, joined server-side: a client that assembled them
    // itself would render a row nobody's database was ever in.
    const { client, requests } = clientAnswering(registryPayload());

    await registry.read(client);

    expect(requests).toHaveLength(1);
  });

  it("names no workspace — the read is scoped to the session's own", async () => {
    const { client, requests } = clientAnswering(registryPayload());

    await registry.read(client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
    expect(new URL(requests[0]?.url ?? "").search).toBe("");
  });

  it("hands the derived cells across untouched — chips, health, price display, usedBy", async () => {
    // What the table must not re-derive survives the crossing exactly as served, including
    // the values for *nothing here*: an empty chip list, a null binding, a `—` price.
    const { client } = clientAnswering(registryPayload());

    const payload = await registry.read(client);
    const orphan = payload.aliases.find((row) => row.alias === "gpt5-experiments");
    const max = payload.aliases.find((row) => row.alias === "coder-max");

    expect(orphan?.binding).toBeNull();
    expect(orphan?.chips).toEqual([]);
    expect(orphan?.price).toMatchObject({ price: null, display: "—" });
    expect(orphan?.health).toMatchObject({ state: "no_key", fix: "/models/providers" });
    expect(max?.chips).toEqual(["max thinking", "400k budget"]);
    expect(max?.usedBy).toBe(4);
    expect(max?.references).toHaveLength(4);
  });

  it("answers an empty workspace with an empty list rather than a failure", async () => {
    const { client } = clientAnswering(registryPayload([]));

    await expect(registry.read(client)).resolves.toEqual({ aliases: [] });
  });

  it("rejects with the service's refusal, code and message intact", async () => {
    const { client } = clientAnswering(NO_ORGANIZATION, 400);

    await expect(registry.read(client)).rejects.toMatchObject({
      status: 400,
      code: "organization_required",
      message: NO_ORGANIZATION.message,
    });
    await expect(registry.read(client)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("registry.update", () => {
  /** What a switch-off of the seeded `coder-max` answers with. */
  const CHANGE = {
    alias: modelAlias({ enabled: false }),
    revisionId: "a1000000-0000-4000-8000-000000000009",
    warnings: [],
    nextResolution: null,
    droppedHops: seededRegistry()[1]?.references ?? [],
  };

  it("PATCHes the one alias with only what changes", async () => {
    const stored = registryAlias();
    const { client, requests } = stubClient(() => ({ body: CHANGE }));

    const payload = await registry.update(stored.id, { enabled: false }, client);

    expect(requests[0]?.url).toBe(
      `http://rest.test:4000/api/v1/registry/aliases/${stored.id}`,
    );
    expect(requests[0]?.method).toBe("PATCH");
    await expect(requests[0]?.json()).resolves.toEqual({ enabled: false });
    expect(payload).toEqual(CHANGE);
  });

  it("hands the dropped hops across, so the switch can say what a switch-off did", async () => {
    const { client } = stubClient(() => ({ body: CHANGE }));

    const payload = await registry.update(registryAlias().id, { enabled: false }, client);

    expect(payload.droppedHops.map((reference) => reference.label)).toEqual([
      "implement-primary",
      "plan-primary",
      "review-primary",
      "escalation:effort≥L",
    ]);
  });

  it("rejects with the service's refusal — the binding gate is the service's", async () => {
    const { client } = clientAnswering(
      {
        code: "model_alias_unbound",
        message: "This alias has no provider connection.",
        details: { fix: "/models/providers" },
      },
      422,
    );

    await expect(
      registry.update(registryAlias().id, { enabled: true }, client),
    ).rejects.toMatchObject({ status: 422, code: "model_alias_unbound" });
  });
});
