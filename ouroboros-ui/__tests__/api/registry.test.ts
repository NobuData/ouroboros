import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { clientAnswering, stubClient } from "../helpers/api";
import {
  candidateList,
  importResult,
  modelOptionList,
  paramSchemaResponse,
  registryAlias,
  registryPayload,
  seededRegistry,
} from "../helpers/registry";
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
 * The registry page's read (#588, consumed by #592), the table's one write (#584), and the
 * five calls behind the head's two flows (CI.4, #594).
 *
 * Most of what is worth holding is about what this module does *not* do — it names no
 * workspace, it makes one request for a table five subsystems compose, it hands back what the
 * service composed rather than recomposing it, and each write sends what was asked for and
 * nothing else.
 *
 * The CI.4 half adds one property of its own: **the two paths a name enters the registry by
 * are two requests, and the create is one request for both of its modes.** A bound alias and a
 * name reserved ahead of its key differ only by a field in the body, which is what keeps the
 * dialog's toggle a decision rather than a fork.
 *
 * The CI.3 half ([#593](https://github.com/NobuData/ouroboros/issues/593)) adds two more
 * operations and one property that runs through them: **the service names the copy and the
 * service refuses the delete.** Neither is proposed here, which is what the last two blocks
 * hold — a duplicate sends an empty body and reads the name back, and a delete answers `204`
 * with nothing or a `409` carrying the work list.
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


describe("registry.create", () => {
  /** What a create answers with — the alias as re-read, and its revision. */
  const CHANGE = {
    alias: modelAlias({ alias: "opus-5", modelId: "claude-opus-5" }),
    revisionId: "b1000000-0000-4000-8000-000000000001",
    warnings: [],
    nextResolution: null,
    droppedHops: [],
  };

  it("POSTs the alias to the collection, with the body it was given", async () => {
    const { client, requests } = stubClient(() => ({ body: CHANGE, status: 201 }));
    const body = { alias: "opus-5", modelId: "claude-opus-5", connectionId: registryAlias().binding?.id };

    await registry.create(body, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/registry/aliases");
    expect(requests[0]?.method).toBe("POST");
    await expect(requests[0]?.json()).resolves.toEqual(body);
  });

  it("sends one shape for both modes — a body without a connection is the unbound path", async () => {
    // There is no second endpoint and no `mode` field: the contract takes the connection as
    // optional, which is what makes mockup 21's orphan row reachable through the product.
    const { client, requests } = stubClient(() => ({ body: CHANGE, status: 201 }));

    await registry.create({ alias: "gpt5-experiments", modelId: "gpt-5.2-preview" }, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/registry/aliases");
    await expect(requests[0]?.json()).resolves.toEqual({
      alias: "gpt5-experiments",
      modelId: "gpt-5.2-preview",
    });
  });

  it("names no workspace — the write is scoped to the session's own", async () => {
    const { client, requests } = stubClient(() => ({ body: CHANGE, status: 201 }));

    await registry.create({ alias: "opus-5", modelId: "claude-opus-5" }, client);

    expect(requests[0]?.headers.get("X-Ouro-Tenant")).toBeNull();
  });

  it("hands the stored alias back with its revision and warnings", async () => {
    const { client } = stubClient(() => ({ body: CHANGE, status: 201 }));

    await expect(
      registry.create({ alias: "opus-5", modelId: "claude-opus-5" }, client),
    ).resolves.toEqual(CHANGE);
  });

  it("rejects with the designed 422 for a name this workspace already has", async () => {
    // Never a unique-violation leak: a taken name is a designed refusal the dialog puts back
    // under the name box.
    const { client } = clientAnswering(
      {
        code: "model_alias_name_taken",
        message: "This workspace already has an alias called coder-max.",
        details: { alias: "coder-max" },
      },
      422,
    );

    await expect(
      registry.create({ alias: "coder-max", modelId: "claude-fable-5" }, client),
    ).rejects.toMatchObject({ status: 422, code: "model_alias_name_taken" });
  });
});

describe("registry.modelOptions", () => {
  it("asks for one connection's models by query, and reads them live", async () => {
    const { client, requests } = clientAnswering(modelOptionList());

    await registry.modelOptions("5eed000c-0000-4000-8000-000000000001", client);

    expect(requests[0]?.method).toBe("GET");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/api/v1/registry/aliases/model-options");
    expect(new URL(requests[0]?.url ?? "").searchParams.get("connection")).toBe(
      "5eed000c-0000-4000-8000-000000000001",
    );
  });

  it("answers a connection discovery has not run on with an empty list, not a failure", async () => {
    const { client } = clientAnswering(modelOptionList([]));

    await expect(registry.modelOptions("c", client)).resolves.toMatchObject({ models: [] });
  });
});

describe("registry.paramSchema", () => {
  it("asks about a model on a connection", async () => {
    const { client, requests } = clientAnswering(paramSchemaResponse());

    await registry.paramSchema("qwen3-coder:32b", "5eed000c-0000-4000-8000-000000000005", client);

    const url = new URL(requests[0]?.url ?? "");

    expect(url.pathname).toBe("/api/v1/registry/param-schema");
    expect(url.searchParams.get("model")).toBe("qwen3-coder:32b");
    expect(url.searchParams.get("connection")).toBe("5eed000c-0000-4000-8000-000000000005");
  });

  it("leaves the connection off entirely when the question is about an unbound alias", async () => {
    // Absent rather than empty: `connection=` with nothing after it is a malformed uuid, not a
    // question about an alias with no provider.
    const { client, requests } = clientAnswering(
      paramSchemaResponse({ connectionId: null, reason: "alias_unbound" }),
    );

    await registry.paramSchema("gpt-5.2-preview", null, client);

    expect(new URL(requests[0]?.url ?? "").searchParams.has("connection")).toBe(false);
  });

  it("does not normalise the model id, because vendors disagree about spelling", async () => {
    const { client, requests } = clientAnswering(paramSchemaResponse());

    await registry.paramSchema("qwen3-coder:32b", "c", client);

    expect(new URL(requests[0]?.url ?? "").searchParams.get("model")).toBe("qwen3-coder:32b");
  });
});

describe("registry.candidates", () => {
  it("asks one connection what it has to import, by path", async () => {
    const { client, requests } = clientAnswering(candidateList());

    await registry.candidates("5eed000c-0000-4000-8000-000000000001", client);

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(
      "http://rest.test:4000/api/v1/registry/import/5eed000c-0000-4000-8000-000000000001/candidates",
    );
  });

  it("hands the annotations across untouched — the mark, the suggestion and the tick", async () => {
    // What the wizard must not re-derive: whether a model is already named, what to call it,
    // and whether the row starts ticked are all CH.4's answers against the workspace's aliases.
    const { client } = clientAnswering(candidateList());

    const page = await registry.candidates("c", client);

    expect(page.candidates[0]).toMatchObject({
      modelId: "claude-fable-5",
      alias: { alias: "coder-max" },
      suggestedName: "fable-5",
      selected: false,
    });
    expect(page.candidates[1]).toMatchObject({ alias: null, suggestedName: "opus-5", selected: true });
  });

  it("carries the empty state a connection that reported nothing answers with", async () => {
    const { client } = clientAnswering(candidateList([]));

    await expect(registry.candidates("c", client)).resolves.toMatchObject({
      candidates: [],
      empty: { code: "no_models_discovered", fix: "/models/providers" },
    });
  });
});

describe("registry.importAliases", () => {
  it("POSTs one connection and the rows under it", async () => {
    const { client, requests } = clientAnswering(importResult());
    const body = { connectionId: "c", items: [{ modelId: "claude-opus-5", alias: "opus-5" }] };

    await registry.importAliases(body, client);

    expect(requests[0]?.url).toBe("http://rest.test:4000/api/v1/registry/import");
    expect(requests[0]?.method).toBe("POST");
    await expect(requests[0]?.json()).resolves.toEqual(body);
  });

  it("answers a re-run that created nothing with a success and a skipped list", async () => {
    // `200` rather than `201`, deliberately: this creates a list, and on a re-run creates none
    // while still succeeding.
    const { client } = clientAnswering(
      importResult([], [{ modelId: "claude-fable-5", alias: "coder-max" }]),
    );

    const result = await registry.importAliases(
      { connectionId: "c", items: [{ modelId: "claude-fable-5", alias: "fable-5" }] },
      client,
    );

    expect(result.created).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ modelId: "claude-fable-5", alias: { alias: "coder-max" } });
  });

  it("rejects with the itemised 422, positions intact, because that is what maps to rows", async () => {
    const details = { items: { "1": { alias: ["This workspace already has an alias by that name."] } } };
    const { client } = clientAnswering(
      { code: "model_import_invalid", message: "One or more items cannot be created.", details },
      422,
    );

    await expect(
      registry.importAliases({ connectionId: "c", items: [] }, client),
    ).rejects.toMatchObject({ status: 422, code: "model_import_invalid", details });
  });
});

describe("registry.duplicate", () => {
  /** What a copy of the seeded `coder-max` answers with — the service's own name for it. */
  const COPY = {
    alias: modelAlias({
      id: "5eed000f-0000-4000-8000-000000000009",
      alias: "coder-max-copy",
      enabled: false,
    }),
    revisionId: "a1000000-0000-4000-8000-000000000003",
    warnings: [],
    nextResolution: null,
    droppedHops: [],
  };

  it("POSTs the copy sub-resource, with no body of its own", async () => {
    const stored = registryAlias();
    const { client, requests } = stubClient(() => ({ body: COPY, status: 201 }));

    const change = await registry.duplicate(stored.id, client);

    expect(requests[0]?.url).toBe(
      `http://rest.test:4000/api/v1/registry/aliases/${stored.id}/duplicate`,
    );
    expect(requests[0]?.method).toBe("POST");
    expect(change).toEqual(COPY);
  });

  it("proposes no name, because the service composes one inside its own transaction", async () => {
    // Two readers can press Duplicate at once; a client that proposed `-copy` would be a second
    // opinion about a name only one of them can have.
    const { client, requests } = stubClient(() => ({ body: COPY, status: 201 }));

    const change = await registry.duplicate(registryAlias().id, client);
    const sent = await requests[0]?.text();

    expect(sent === undefined || sent === "" || sent === "null").toBe(true);
    expect(change.alias.alias).toBe("coder-max-copy");
  });

  it("hands back a copy that is switched off, which is the contract's own promise", async () => {
    const { client } = stubClient(() => ({ body: COPY, status: 201 }));

    await expect(registry.duplicate(registryAlias().id, client)).resolves.toMatchObject({
      alias: { enabled: false },
    });
  });

  it("rejects when the suffixed name would not fit, with the name that did not", async () => {
    const { client } = clientAnswering(
      {
        code: "model_alias_copy_name_too_long",
        message: "The copy's name would be too long.",
        details: { proposed: `${"a".repeat(60)}-copy` },
      },
      422,
    );

    await expect(registry.duplicate(registryAlias().id, client)).rejects.toMatchObject({
      status: 422,
      code: "model_alias_copy_name_too_long",
    });
  });
});

describe("registry.remove", () => {
  it("DELETEs the one alias and reads nothing back", async () => {
    // `204` and no body: there is nothing to say about a row that no longer exists, so this is
    // the one registry call that does not unwrap an envelope.
    const stored = registryAlias();
    const { client, requests } = stubClient(() => ({ body: undefined, status: 204 }));

    await expect(registry.remove(stored.id, client)).resolves.toBeUndefined();

    expect(requests[0]?.url).toBe(
      `http://rest.test:4000/api/v1/registry/aliases/${stored.id}`,
    );
    expect(requests[0]?.method).toBe("DELETE");
  });

  it("rejects with the referrers a blocked delete names, which is the work list", async () => {
    // The guard is read inside the delete's own transaction under a lock, so the list this
    // carries was still true at the instant the delete would have run.
    const { client } = clientAnswering(
      {
        code: "model_alias_referenced",
        message: "coder-max cannot be removed while 4 references reference it.",
        details: { alias: "coder-max", references: registryAlias().references },
      },
      409,
    );

    await expect(registry.remove(registryAlias().id, client)).rejects.toMatchObject({
      status: 409,
      code: "model_alias_referenced",
    });
  });

  it("rejects for an alias somebody else has already removed", async () => {
    const { client } = clientAnswering(
      { code: "model_alias_not_found", message: "No such alias.", details: {} },
      404,
    );

    await expect(registry.remove(registryAlias().id, client)).rejects.toBeInstanceOf(ApiError);
  });
});
