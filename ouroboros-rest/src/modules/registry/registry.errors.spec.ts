import { ConflictError, NotFoundError } from "../errors/error.envelope";
import {
  FOREIGN_KEY_VIOLATION,
  PROVIDER_DEPENDENCY_CONSTRAINT,
  REGISTRY_ERRORS,
  aliasNotFound,
  isProviderConnectionInUse,
  providerConnectionInUse,
} from "./registry.errors";

/**
 * The two refusals, and the recogniser for the one PostgreSQL raises.
 *
 * `provider_connection_in_use` is the ticket's fourth acceptance criterion — *blocked with a
 * clear, designed error message* — so most of this suite is about the message rather than
 * the status: a refusal that does not say what is in the way is a refusal somebody can only
 * be annoyed by.
 *
 * That the constraint really fires, and really carries the name
 * {@link isProviderConnectionInUse} looks for, is `registry.integration-spec.ts`'s question
 * against a migrated database. Asserting it here would only prove that a hand-written object
 * matches a hand-written predicate.
 */

const CONNECTION = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

describe("aliasNotFound", () => {
  it("is a 404 carrying the published code", () => {
    const error = aliasNotFound("coder-max");

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe(REGISTRY_ERRORS.aliasNotFound);
  });

  it("echoes the name exactly as it was asked for", () => {
    // V015 stores aliases folded, so `Coder-Max` genuinely is not `coder-max` — and a caller
    // who spelled it with a capital needs to see which spelling was searched for rather than
    // a tidied version of what they sent.
    expect(aliasNotFound("Coder-Max").details).toEqual({ alias: "Coder-Max" });
  });

  it("says nothing about what the workspace does have", () => {
    // The message is deliberately not "did you mean coder-max": a 404 that enumerated
    // neighbours would let a caller walk one workspace's registry out of it one guess at a
    // time.
    expect(aliasNotFound("nope").envelope().message).toBe(
      "This workspace has no model alias by that name.",
    );
  });
});

describe("providerConnectionInUse", () => {
  it("is a 409 carrying the published code", () => {
    const error = providerConnectionInUse(CONNECTION, ["coder-max"]);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe(REGISTRY_ERRORS.providerConnectionInUse);
  });

  it("names the one alias in the way, and says what to do about it", () => {
    expect(providerConnectionInUse(CONNECTION, ["coder-max"]).envelope().message).toBe(
      "This provider connection cannot be removed while coder-max resolves on it. " +
        "Repoint or remove it first.",
    );
  });

  it("reads as a sentence with two aliases", () => {
    expect(
      providerConnectionInUse(CONNECTION, ["coder-max", "local-docs"]).envelope().message,
    ).toBe(
      "This provider connection cannot be removed while coder-max and local-docs resolve on it. " +
        "Repoint or remove them first.",
    );
  });

  it("reads as a sentence with three", () => {
    expect(
      providerConnectionInUse(CONNECTION, ["coder-max", "local-docs", "sizer"]).envelope().message,
    ).toBe(
      "This provider connection cannot be removed while coder-max, local-docs and sizer resolve on it. " +
        "Repoint or remove them first.",
    );
  });

  it("carries the names as data as well as prose", () => {
    // The message is for a person; `details.aliases` is for the surface that wants to render
    // them as links to the registry rows they name.
    const error = providerConnectionInUse(CONNECTION, ["coder-max", "local-docs"]);

    expect(error.details).toEqual({
      connectionId: CONNECTION,
      aliases: ["coder-max", "local-docs"],
    });
  });

  it("copies the list rather than holding the caller's array", () => {
    const aliases = ["coder-max"];
    const error = providerConnectionInUse(CONNECTION, aliases);

    aliases.push("added-later");

    expect(error.details.aliases).toEqual(["coder-max"]);
  });

  it("refuses to describe a refusal that did not happen", () => {
    // An empty list means nothing was blocking, so this error would be claiming a conflict
    // the database never raised. A programming error at the call site, and loud rather than a
    // sentence that trails off.
    expect(() => providerConnectionInUse(CONNECTION, [])).toThrow(RangeError);
  });
});

describe("isProviderConnectionInUse", () => {
  it("recognises the violation V015's restrict raises", () => {
    expect(
      isProviderConnectionInUse({
        code: FOREIGN_KEY_VIOLATION,
        constraint: PROVIDER_DEPENDENCY_CONSTRAINT,
      }),
    ).toBe(true);
  });

  it("does not recognise a different foreign key violated by the same statement", () => {
    // Both fields are checked for this reason: *some* foreign key was violated is not the
    // same fact as *this* one was, and answering a 409 about aliases for an unrelated
    // violation would be a designed message about the wrong thing.
    expect(
      isProviderConnectionInUse({ code: FOREIGN_KEY_VIOLATION, constraint: "some_other_fkey" }),
    ).toBe(false);
  });

  it("does not recognise a different error class on the same constraint", () => {
    expect(
      isProviderConnectionInUse({ code: "23505", constraint: PROVIDER_DEPENDENCY_CONSTRAINT }),
    ).toBe(false);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "23503"],
    ["a plain error", new Error("boom")],
    ["an object with no code", { constraint: PROVIDER_DEPENDENCY_CONSTRAINT }],
  ])("does not recognise %s", (_name, value) => {
    expect(isProviderConnectionInUse(value)).toBe(false);
  });
});
