import { describe, expect, it } from "vitest";

import { PROVIDERS_PATH } from "@/app/paths";
import {
  CONNECTION_GONE,
  CREATE_INVALID,
  CREATE_PARAMS_INVALID,
  CREATE_READ_ONLY,
  type CreateDraft,
  MAX_NAME_LENGTH,
  NAME_PATTERN,
  NAME_SHAPE,
  NAME_TAKEN,
  NEEDS_MODEL,
  NEEDS_NAME,
  NEEDS_PROVIDER,
  NOTHING_CREATED,
  UNBOUND_HREF,
  UNBOUND_NOTICE,
  createBody,
  createFailure,
  nameError,
  nameProblem,
  submitReason,
} from "@/app/registry/create";

import { seededRegistry } from "../helpers/registry";

/**
 * The **+ New alias** dialog, as decisions (#594).
 *
 * The ticket's own problem statement is the thing this suite exists to hold: *creating an alias
 * before the key exists is a real workflow*, the schema has always allowed it (decision **R2**),
 * and a dialog that demanded a provider would make a supported state unreachable through the
 * product. So the two modes are asserted as **one body with a connection in it or without**,
 * rather than as two code paths — that is what makes the second mode a first-class path rather
 * than a special case somebody has to remember to keep working.
 *
 * The rest is the two ways a create is refused and where each refusal lands. A name already
 * taken has to end up under the name box whether the browser caught it or the service did; a
 * parameter the model cannot honour has to end up under that parameter's control; and a
 * refusal this module has no sentence for still has to say what state the workspace is in.
 */

/** Every alias name the seeded workspace has. */
const TAKEN = seededRegistry().map((alias) => alias.alias);

/**
 * A draft, defaulting to a well-formed bound one.
 *
 * @param over What this case is about.
 * @returns The draft.
 */
function draft(over: Partial<CreateDraft> = {}): CreateDraft {
  return {
    alias: "opus-5",
    mode: "now",
    connectionId: "5eed000c-0000-4000-8000-000000000001",
    modelId: "claude-opus-5",
    params: {},
    ...over,
  };
}

describe("what is wrong with a name", () => {
  it("says nothing about an empty box, because a dialog does not open by telling somebody off", () => {
    expect(nameProblem("", TAKEN)).toBe("empty");
    expect(nameError("empty")).toBeUndefined();
  });

  it("refuses anything that is not lower-case kebab", () => {
    // V015's CHECK, restated: uniqueness is enforced on the stored text, so `Coder-Max` beside
    // `coder-max` would give one name two resolutions.
    for (const bad of ["Coder-Max", "coder max", "coder--max", "-coder", "coder-", "coder_max"]) {
      expect(nameProblem(bad, TAKEN), bad).toBe("shape");
    }
    expect(nameError("shape")).toBe(NAME_SHAPE);
  });

  it("refuses a name past the column's ceiling", () => {
    expect(nameProblem("a".repeat(MAX_NAME_LENGTH + 1), TAKEN)).toBe("shape");
    expect(nameProblem("a".repeat(MAX_NAME_LENGTH), TAKEN)).toBeNull();
  });

  it("catches the ordinary collision against the table the reader is looking at", () => {
    expect(nameProblem("coder-max", TAKEN)).toBe("taken");
    expect(nameError("taken")).toBe(NAME_TAKEN);
  });

  it("checks the shape before the collision, because a malformed name is taken by nobody", () => {
    expect(nameProblem("Coder-Max", TAKEN)).toBe("shape");
  });

  it("passes a free, well-formed name", () => {
    expect(nameProblem("opus-5", TAKEN)).toBeNull();
    expect(nameError(null)).toBeUndefined();
  });

  it("trims before it judges, so trailing space is not a shape error", () => {
    expect(nameProblem("  opus-5  ", TAKEN)).toBeNull();
    expect(nameProblem("  coder-max  ", TAKEN)).toBe("taken");
  });

  it("keeps the pattern the service publishes, rather than a looser one", () => {
    expect(NAME_PATTERN.source).toBe("^[a-z0-9]+(-[a-z0-9]+)*$");
  });
});

describe("the body both modes compose", () => {
  it("sends the connection for a bound alias", () => {
    expect(createBody(draft())).toEqual({
      alias: "opus-5",
      modelId: "claude-opus-5",
      connectionId: "5eed000c-0000-4000-8000-000000000001",
    });
  });

  it("omits the connection entirely for a name created ahead of its key", () => {
    // Omitted rather than sent as null: the request says *this alias has no provider* rather
    // than *set this alias's provider to nothing*, and only one of those reads as a decision.
    const body = createBody(draft({ mode: "later", connectionId: null, modelId: "gpt-5.2-preview" }));

    expect(body).toEqual({ alias: "opus-5", modelId: "gpt-5.2-preview" });
    expect("connectionId" in body).toBe(false);
  });

  it("is one shape for both modes — no second endpoint, no mode field", () => {
    // The contract takes the connection as optional, which is what makes the toggle a decision
    // about one request rather than a fork in the client.
    expect(Object.keys(createBody(draft({ mode: "later", connectionId: null }))).sort()).toEqual([
      "alias",
      "modelId",
    ]);
  });

  it("carries the parameters a bound draft filled in, and omits an empty document", () => {
    expect(createBody(draft({ params: { thinking: "max" } }))).toMatchObject({
      params: { thinking: "max" },
    });
    expect("params" in createBody(draft())).toBe(false);
  });

  it("drops the parameters when the mode is bind-later, rather than sending a certain 422", () => {
    // Every param is refused for an unbound alias, because nothing knows what the model
    // supports — so a change of mind must not become a refusal.
    expect(
      createBody(draft({ mode: "later", connectionId: null, params: { thinking: "max" } })),
    ).toEqual({ alias: "opus-5", modelId: "claude-opus-5" });
  });

  it("never sends `enabled`, because the contract's own default is what the modes promise", () => {
    // On for a bound alias, forced off for an unbound one. A client restating the rule would be
    // a second place for it to drift.
    for (const mode of ["now", "later"] as const) {
      const body = createBody(draft({ mode, connectionId: mode === "now" ? "c" : null }));

      expect("enabled" in body, mode).toBe(false);
    }
  });

  it("trims the name and the model on the way out", () => {
    expect(createBody(draft({ alias: " opus-5 ", modelId: " claude-opus-5 " }))).toMatchObject({
      alias: "opus-5",
      modelId: "claude-opus-5",
    });
  });
});

describe("why the submit is inert", () => {
  it("asks for a name first, and says so for every way the name is not ready", () => {
    for (const problem of ["empty", "shape", "taken"] as const) {
      expect(submitReason(draft(), problem), problem).toBe(NEEDS_NAME);
    }
  });

  it("asks for a provider once the name is good, in bind-now", () => {
    expect(submitReason(draft({ connectionId: null }), null)).toBe(NEEDS_PROVIDER);
  });

  it("never asks bind-later for a provider, which is the whole point of the mode", () => {
    expect(submitReason(draft({ mode: "later", connectionId: null }), null)).toBeUndefined();
  });

  it("asks for a model last, in either mode", () => {
    expect(submitReason(draft({ modelId: "  " }), null)).toBe(NEEDS_MODEL);
    expect(submitReason(draft({ mode: "later", connectionId: null, modelId: "" }), null)).toBe(
      NEEDS_MODEL,
    );
  });

  it("lets a complete draft through", () => {
    expect(submitReason(draft(), null)).toBeUndefined();
  });

  it("never points past a blank field at a later one", () => {
    // A draft with nothing in it at all is told about the name, not about the provider.
    expect(submitReason(draft({ alias: "", connectionId: null, modelId: "" }), "empty")).toBe(
      NEEDS_NAME,
    );
  });
});

describe("what a refusal draws", () => {
  it("puts a taken name under the name box, the same sentence the browser would have", () => {
    // A reader must never learn about a taken name from anywhere but the name field, whichever
    // of the two routes caught it.
    const failure = createFailure({ code: "model_alias_name_taken", message: "taken", details: { alias: "opus-5" } });

    expect(failure.alias).toBe(NAME_TAKEN);
    expect(failure.message).toContain(NOTHING_CREATED);
  });

  it("hands a params refusal straight to the controls it named", () => {
    const failure = createFailure(
      { code: "model_alias_params_invalid", message: "no", details: {} },
      { thinking: ["thinking must be one of off, std, max"] },
    );

    expect(failure.message).toBe(CREATE_PARAMS_INVALID);
    expect(failure.params).toEqual({ thinking: ["thinking must be one of off, std, max"] });
  });

  it("files a malformed body against the fields it is about", () => {
    const failure = createFailure({
      code: "validation_failed",
      message: "bad",
      details: { alias: ["alias must be lower-case"], modelId: ["model must not be blank"] },
    });

    expect(failure.message).toBe(CREATE_INVALID);
    expect(failure.alias).toBe("alias must be lower-case");
    expect(failure.modelId).toBe("model must not be blank");
    expect(failure.connectionId).toBeUndefined();
  });

  it("gives a role refusal the sentence alone, because there is nothing in the form to correct", () => {
    const failure = createFailure({ code: "forbidden", message: "no", details: {} });

    expect(failure.message).toBe(CREATE_READ_ONLY);
    expect(failure.alias).toBeUndefined();
    expect(failure.params).toEqual({});
  });

  it("puts a vanished connection under the provider select, which is where it can be changed", () => {
    const failure = createFailure({
      code: "provider_connection_not_found",
      message: "gone",
      details: {},
    });

    expect(failure.message).toBe(CONNECTION_GONE);
    expect(failure.connectionId).toBe(CONNECTION_GONE);
  });

  it("keeps the service's own sentence for a code it has none for, after the product's", () => {
    // The service's message is written for an API caller; it goes after the line that says what
    // state the workspace is in, never instead of it.
    const failure = createFailure({ code: "teapot", message: "The service is a teapot.", details: {} });

    expect(failure.message).toContain(NOTHING_CREATED);
    expect(failure.message).toContain("The service is a teapot.");
  });

  it("says nothing was created, in every sentence a refusal can draw", () => {
    // One POST writes one row inside one transaction, so there is no partial state to describe
    // — and a reader who is not told that will go looking for a half-made alias.
    for (const sentence of [CREATE_INVALID, CREATE_PARAMS_INVALID, CREATE_READ_ONLY, CONNECTION_GONE]) {
      expect(sentence, sentence).toContain(NOTHING_CREATED);
    }
  });
});

describe("the bind-later notice", () => {
  it("describes the row the mode produces, before it is produced", () => {
    // Saying so first is what makes mockup 21's orphan row read as a state somebody chose.
    expect(UNBOUND_NOTICE).toMatch(/stay disabled until a provider is connected/);
    expect(UNBOUND_NOTICE).toMatch(/no provider and no key/);
  });

  it("points at the page that fixes it, spelled from app/paths.ts", () => {
    expect(UNBOUND_HREF).toBe(PROVIDERS_PATH);
  });
});
