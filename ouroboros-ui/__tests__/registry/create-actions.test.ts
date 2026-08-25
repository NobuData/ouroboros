import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import { MODELS_UNREADABLE, PARAMS_UNREADABLE } from "@/app/registry/create";

import { modelOptionList, paramSchemaResponse, registryAlias } from "../helpers/registry";

/**
 * The create dialog's three server hops (#594).
 *
 * A Server Action is a POST endpoint anybody can reach, so every action suite in this module is
 * written as the security case first. Here it is the shape of the calls: **none of the three
 * takes a workspace or a person**, so there is nothing to forge — an alias belongs to the
 * workspace the caller's own session is acting in, and the role gate is the service's, which is
 * why the two reads are deliberately not gated here at all.
 *
 * The rest is the posture. A refusal is a value the dialog draws rather than a rejection that
 * would replace the page underneath it; an empty model list is an **answer** and not a failure;
 * a parameter schema that could not be read does not stop a create; and the gate's redirect is
 * the one throw that must travel.
 */

/** What the API answers, per case. */
const create = vi.fn();
const modelOptions = vi.fn();
const paramSchema = vi.fn();

vi.mock("@/app/api/registry", () => ({
  registry: {
    create: (body: unknown) => create(body),
    modelOptions: (id: string) => modelOptions(id),
    paramSchema: (model: string, connection: string | null) => paramSchema(model, connection),
  },
}));

const { createAlias, readModelOptions, readParamSchema } = await import(
  "@/app/registry/create-actions"
);

/** The refusal a dialog most often meets, and the one the name box has to draw. */
const NAME_TAKEN = new ApiError(
  422,
  "model_alias_name_taken",
  "This workspace already has an alias called coder-max.",
  { alias: "coder-max" },
);

beforeEach(() => {
  create.mockReset().mockResolvedValue({
    alias: registryAlias({ alias: "opus-5" }),
    revisionId: "b1000000-0000-4000-8000-000000000001",
    warnings: [],
    nextResolution: null,
    droppedHops: [],
  });
  modelOptions.mockReset().mockResolvedValue(modelOptionList());
  paramSchema.mockReset().mockResolvedValue(paramSchemaResponse());
});

describe("listing a connection's models", () => {
  it("asks about the connection it was given and names nothing else", () => {
    // No workspace and no person: the read is scoped to the session's own workspace by the
    // service, so there is nothing here to point at somebody else's.
    void readModelOptions("5eed000c-0000-4000-8000-000000000001");

    expect(modelOptions).toHaveBeenCalledExactlyOnceWith("5eed000c-0000-4000-8000-000000000001");
  });

  it("hands back the models in the order the service served them", async () => {
    await expect(readModelOptions("c")).resolves.toEqual({
      ok: true,
      models: modelOptionList().models,
    });
  });

  it("answers a connection discovery has not run on with an empty list, not a failure", async () => {
    // The contract is explicit: an alias may still be created by typing the model, and the
    // create answers with a `model_not_discovered` warning rather than a refusal.
    modelOptions.mockResolvedValue(modelOptionList([]));

    await expect(readModelOptions("c")).resolves.toEqual({ ok: true, models: [] });
  });

  it("turns a refusal into a sentence the dialog can draw", async () => {
    modelOptions.mockRejectedValue(new ApiError(404, "provider_connection_not_found", "gone"));

    await expect(readModelOptions("c")).resolves.toEqual({
      ok: false,
      reason: MODELS_UNREADABLE,
    });
  });

  it("tells the reader to type the model instead, rather than only that it failed", async () => {
    expect(MODELS_UNREADABLE).toMatch(/type the model id/);
  });

  it("lets the gate's redirect through, so an expired session still reaches login", async () => {
    // A `catch` wide enough to hold Next.js's redirect signal would swallow the navigation and
    // draw a dialog captioned with the framework's internal message.
    modelOptions.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(readModelOptions("c")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("reading a model's parameter schema", () => {
  it("asks about the model on the connection, in the provider's own spelling", () => {
    void readParamSchema("qwen3-coder:32b", "5eed000c-0000-4000-8000-000000000005");

    expect(paramSchema).toHaveBeenCalledExactlyOnceWith(
      "qwen3-coder:32b",
      "5eed000c-0000-4000-8000-000000000005",
    );
  });

  it("asks with no connection for an unbound alias, which is a question and not a mistake", async () => {
    await readParamSchema("gpt-5.2-preview");

    expect(paramSchema).toHaveBeenCalledExactlyOnceWith("gpt-5.2-preview", null);
  });

  it("hands the answer across whole, both sections and the reason", async () => {
    await expect(readParamSchema("claude-fable-5", "c")).resolves.toEqual({
      ok: true,
      schema: paramSchemaResponse(),
    });
  });

  it("turns a refusal into a sentence, and says the alias can still be created", async () => {
    // A form that cannot be drawn is not a create that failed.
    paramSchema.mockRejectedValue(new ApiError(500, "internal_error", "boom"));

    await expect(readParamSchema("m", "c")).resolves.toEqual({
      ok: false,
      reason: PARAMS_UNREADABLE,
    });
    expect(PARAMS_UNREADABLE).toMatch(/can still be created/);
  });

  it("lets the gate's redirect through", async () => {
    paramSchema.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(readParamSchema("m", "c")).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("creating an alias", () => {
  it("forwards the body the dialog composed, unchanged", async () => {
    // The name's shape, the model's existence in discovery and the parameters' fit are all the
    // service's checks; this module duplicates none of them.
    const body = { alias: "opus-5", modelId: "claude-opus-5", connectionId: "c" };

    await createAlias(body);

    expect(create).toHaveBeenCalledExactlyOnceWith(body);
  });

  it("names no workspace and no person, so there is nothing to forge", async () => {
    await createAlias({ alias: "opus-5", modelId: "claude-opus-5" });

    const [sent] = create.mock.calls[0] as [Record<string, unknown>];

    for (const forgeable of ["organizationId", "workspaceId", "tenant", "userId", "createdBy"]) {
      expect(forgeable in sent, forgeable).toBe(false);
    }
  });

  it("answers with the stored name, which is what the page then selects", async () => {
    // The name as *stored*, not as typed: the row that appears is the row the service made.
    await expect(createAlias({ alias: "opus-5", modelId: "claude-opus-5" })).resolves.toEqual({
      ok: true,
      alias: "opus-5",
    });
  });

  it("hands a refusal back as a value, with its code, message and details intact", async () => {
    // The dialog is opened over a page the reader is still entitled to be on, and a rejected
    // action would replace it with an error screen — the wrong outcome for *that name is taken*.
    create.mockRejectedValue(NAME_TAKEN);

    await expect(createAlias({ alias: "coder-max", modelId: "claude-fable-5" })).resolves.toEqual({
      ok: false,
      refusal: {
        code: "model_alias_name_taken",
        message: NAME_TAKEN.message,
        details: { alias: "coder-max" },
      },
    });
  });

  it("hands a member's 403 back the same way, because the gate that decides is the service's", async () => {
    // The page draws the action inert for a member, but a check made in the browser is a check
    // anybody can skip.
    create.mockRejectedValue(new ApiError(403, "forbidden", "Creating an alias is owner or admin."));

    await expect(createAlias({ alias: "opus-5", modelId: "m" })).resolves.toMatchObject({
      ok: false,
      refusal: { code: "forbidden" },
    });
  });

  it("lets the gate's redirect through", async () => {
    create.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(createAlias({ alias: "opus-5", modelId: "m" })).rejects.toThrow("NEXT_REDIRECT");
  });
});
