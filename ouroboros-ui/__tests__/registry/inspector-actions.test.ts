import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";

import { registryAlias } from "../helpers/registry";

/**
 * The alias inspector's three server hops (CI.3, #593).
 *
 * A Server Action is a POST endpoint anybody can reach, so this suite is written as the
 * security case first: **none of the three takes a workspace or a person.** An alias belongs to
 * the workspace the caller's own session is acting in, so there is nothing to forge and no way
 * to point a save at somebody else's registry — an id from another workspace is the service's
 * `404`, never a write.
 *
 * The rest is the posture, and it is the same one every action module in this product keeps: a
 * refusal comes back as a **value** the card draws under its foot rather than as a rejection
 * that would replace the page the reader is still entitled to be on, and the gate's redirect is
 * the one throw that must travel.
 *
 * Two properties are this ticket's own:
 *
 * - **The body is whatever was composed**, forwarded unchanged. The diffing is
 *   `inspector.ts`'s and is asserted there; what is asserted here is that nothing is added to
 *   it on the way past — a save that carried a name it did not change would make *rebinding
 *   touches one row* false of the request even where it is true of the database.
 * - **The copy's name is read back rather than proposed.** The service composes `<alias>-copy`
 *   inside the transaction that makes it; this returns what it said.
 */

/** What the API answers, per case. */
const update = vi.fn();
const duplicate = vi.fn();
const remove = vi.fn();

vi.mock("@/app/api/registry", () => ({
  registry: {
    update: (id: string, change: unknown) => update(id, change),
    duplicate: (id: string) => duplicate(id),
    remove: (id: string) => remove(id),
  },
}));

const { duplicateAlias, removeAlias, saveAlias } = await import(
  "@/app/registry/inspector-actions"
);

/** The alias every case here is about. */
const ALIAS = registryAlias();

/** What a write answers with, around one alias. */
function change(alias: ReturnType<typeof registryAlias>) {
  return {
    alias: { ...alias, connection: null, updatedBy: null, createdAt: "", updatedAt: "" },
    revisionId: "b1000000-0000-4000-8000-000000000001",
    warnings: [],
    nextResolution: null,
    droppedHops: [],
  };
}

beforeEach(() => {
  update.mockReset().mockResolvedValue(change(ALIAS));
  duplicate.mockReset().mockResolvedValue(change(registryAlias({ alias: "coder-max-copy" })));
  remove.mockReset().mockResolvedValue(undefined);
});

describe("saving an alias", () => {
  it("addresses the alias by id and names no workspace", () => {
    void saveAlias(ALIAS.id, { connectionId: "bedrock" });

    expect(update).toHaveBeenCalledExactlyOnceWith(ALIAS.id, { connectionId: "bedrock" });
  });

  it("forwards the body exactly, adding nothing the card did not put in it", async () => {
    // A rebind is one field. An action that helpfully resent the name would make the request
    // claim a rename that did not happen.
    await saveAlias(ALIAS.id, { connectionId: "bedrock" });

    expect(update.mock.calls[0]?.[1]).toEqual({ connectionId: "bedrock" });
  });

  it("forwards an empty body as an empty body, because the service decides what that means", async () => {
    // A `PATCH` that changes nothing is a `200` with `revisionId: null` — not a failure, and
    // not something for a client to short-circuit into a different answer.
    await expect(saveAlias(ALIAS.id, {})).resolves.toEqual({ ok: true, alias: "coder-max" });
  });

  it("answers with the stored name, which may not be the name that was sent", async () => {
    // A save can be a rename, and the URL carries the name: the page selects what the service
    // stored rather than what the box held.
    update.mockResolvedValue(change(registryAlias({ alias: "coder-dev" })));

    await expect(saveAlias(ALIAS.id, { alias: "coder-dev" })).resolves.toEqual({
      ok: true,
      alias: "coder-dev",
    });
  });

  it("hands a refusal back as a value, with the envelope intact", async () => {
    update.mockRejectedValue(
      new ApiError(422, "model_alias_rename_blocked", "Four things reference it.", {
        references: ALIAS.references,
      }),
    );

    await expect(saveAlias(ALIAS.id, { alias: "coder-dev" })).resolves.toEqual({
      ok: false,
      refusal: {
        code: "model_alias_rename_blocked",
        message: "Four things reference it.",
        details: { references: ALIAS.references },
      },
    });
  });

  it("lets a member's refusal come back rather than throwing an error screen at them", async () => {
    update.mockRejectedValue(new ApiError(403, "forbidden", "Owners and admins.", {}));

    await expect(saveAlias(ALIAS.id, { alias: "x" })).resolves.toMatchObject({
      ok: false,
      refusal: { code: "forbidden" },
    });
  });

  it("lets anything that is not an ApiError keep travelling", async () => {
    update.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(saveAlias(ALIAS.id, {})).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("duplicating an alias", () => {
  it("addresses the alias by id and sends nothing else", () => {
    void duplicateAlias(ALIAS.id);

    expect(duplicate).toHaveBeenCalledExactlyOnceWith(ALIAS.id);
  });

  it("reads the copy's name back rather than proposing one", async () => {
    // Two readers can press Duplicate at once; the name is composed inside the service's own
    // transaction, and this reports what it chose.
    await expect(duplicateAlias(ALIAS.id)).resolves.toEqual({ ok: true, alias: "coder-max-copy" });
  });

  it("hands a refusal back as a value", async () => {
    duplicate.mockRejectedValue(
      new ApiError(422, "model_alias_copy_name_too_long", "Too long.", { proposed: "x-copy" }),
    );

    await expect(duplicateAlias(ALIAS.id)).resolves.toMatchObject({
      ok: false,
      refusal: { code: "model_alias_copy_name_too_long" },
    });
  });

  it("lets the redirect signal keep travelling", async () => {
    duplicate.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(duplicateAlias(ALIAS.id)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("removing an alias", () => {
  it("addresses the alias by id and reports only that it is gone", async () => {
    await expect(removeAlias(ALIAS.id)).resolves.toEqual({ ok: true });

    expect(remove).toHaveBeenCalledExactlyOnceWith(ALIAS.id);
  });

  it("hands the referrers a blocked delete named back as a value — the work list", async () => {
    // The card's own blocked foot is presentation; this is what decides, and the list is read
    // inside the delete's transaction under a lock.
    remove.mockRejectedValue(
      new ApiError(409, "model_alias_referenced", "Four things reference it.", {
        alias: "coder-max",
        references: ALIAS.references,
      }),
    );

    await expect(removeAlias(ALIAS.id)).resolves.toEqual({
      ok: false,
      refusal: {
        code: "model_alias_referenced",
        message: "Four things reference it.",
        details: { alias: "coder-max", references: ALIAS.references },
      },
    });
  });

  it("hands back a 404 for an alias somebody else has already removed", async () => {
    remove.mockRejectedValue(new ApiError(404, "model_alias_not_found", "No such alias.", {}));

    await expect(removeAlias(ALIAS.id)).resolves.toMatchObject({
      ok: false,
      refusal: { code: "model_alias_not_found" },
    });
  });

  it("lets the redirect signal keep travelling", async () => {
    remove.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(removeAlias(ALIAS.id)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
