import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ModelAliasReference } from "@/app/api/registry";
import { MODELS_PATH, ROUTING_MATRIX_HASH, ROUTING_RULES_HASH } from "@/app/paths";
import { NAME_HINT, NAME_LABEL, PROVIDER_HINT, nameProblem } from "@/app/registry/create";
import {
  ALIAS_GONE,
  COPY_TOO_LONG,
  DUPLICATE_READ_ONLY,
  INSPECTOR_READ_ONLY,
  type InspectorDraft,
  NAME_TAKEN,
  NEEDS_MODEL,
  NEEDS_NAME,
  NOTHING_TO_SAVE,
  NO_KEY_STORED,
  PARAMS_INVALID,
  PROVIDER_HINT_TEXT,
  REFERENCE_KINDS,
  REMOVE_LABEL,
  REMOVE_READ_ONLY,
  RENAME_BLOCKED,
  SAVE_INVALID,
  SAVE_LABEL,
  SAVE_READ_ONLY,
  SAVE_UNBOUND,
  WRITE_LABELS,
  duplicateFailure,
  isDirty,
  otherNames,
  providerOption,
  referenceHref,
  referenceSummary,
  removeFailure,
  removeWhy,
  renameBlocked,
  renameGuardNote,
  saveFailure,
  saveReason,
  unlistedNote,
  updateBody,
} from "@/app/registry/inspector";

import { seededRegistry } from "../helpers/registry";

/**
 * Every decision the alias inspector makes (CI.3, #593), as functions over the dev seed's own
 * rows.
 *
 * Four of them are the ticket's four hard behaviours, and each is asserted as a *property*
 * rather than as a rendering:
 *
 * 1. **A rebind is one field in one request.** {@link updateBody} is diffed rather than
 *    composed, so changing the provider select and saving sends a `connectionId` and nothing
 *    else — which is what makes *zero workflow or route edits* true of the wire as well as of
 *    the database.
 * 2. **The field set is not this module's.** There is no parameter named anywhere in it, and
 *    the cases below feed it documents it has never seen.
 * 3. **The rename guard explains early.** {@link renameGuardNote} says the rule before the
 *    field is touched and {@link saveReason} keeps the button inert after it is, so nothing is
 *    sent that could only come back refused.
 * 4. **Remove's blocked state is designed, and counted.** {@link removeWhy} is the mockup's
 *    line with the row's own number in it, and it agrees with the drawing character for
 *    character.
 *
 * The copy is checked against `docs/mockups/21-model-registry.html` where the mockup has a
 * word for it, the same way `view.test.ts` checks the head.
 */

/** The mockup this card is drawn from, read once. */
const MOCKUP = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "mockups", "21-model-registry.html"),
  "utf8",
);

/** The seeded `coder-max`, which is the row the mockup's inspector draws. */
const CODER_MAX = seededRegistry().find((alias) => alias.alias === "coder-max");

/** …and its four referrers. */
const REFERENCES: readonly ModelAliasReference[] = CODER_MAX?.references ?? [];

/** The alias as stored, in the shape both sides of a comparison take. */
const STORED: InspectorDraft = {
  alias: "coder-max",
  connectionId: "5eed000c-0000-4000-8000-000000000001",
  modelId: "claude-fable-5",
  params: { thinking: "max", token_budget: 400_000 },
  restrictions: {},
};

/**
 * A draft, defaulting to the stored one — an untouched card.
 *
 * @param over What this case changed.
 * @returns The draft.
 */
function draft(over: Partial<InspectorDraft> = {}): InspectorDraft {
  return { ...STORED, ...over };
}

describe("what a save sends", () => {
  it("sends nothing at all for a card nobody touched", () => {
    expect(updateBody(draft(), STORED)).toEqual({});
    expect(isDirty(draft(), STORED)).toBe(false);
  });

  it("sends the binding and what it governs for a rebind, and nothing else", () => {
    // *Point coder-max at Bedrock tomorrow; zero workflow or route edits.* A body carrying a
    // name that did not change would be a request that implies more than happened. The
    // parameters travel with the binding — see the next case for why — and nothing else does.
    const body = updateBody(draft({ connectionId: "bedrock" }), STORED);

    expect(body.connectionId).toBe("bedrock");
    expect(body.params).toEqual(STORED.params);
    expect(body.alias).toBeUndefined();
    expect(body.modelId).toBeUndefined();
    expect(body.restrictions).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(["connectionId", "params"]);
  });

  it("sweeps the parameters along with a rebind, because they are the model's", () => {
    // Switching to a model with no thinking select must send a document with no `thinking` in
    // it; otherwise the service re-validates the stored one against the new model and refuses a
    // save the reader had every reason to think was a rebind.
    const body = updateBody(draft({ modelId: "qwen3-coder:32b", params: {} }), STORED);

    expect(body.modelId).toBe("qwen3-coder:32b");
    expect(body.params).toEqual({});
  });

  it("leaves the restrictions alone through a rebind, because they are the workspace's policy", () => {
    const body = updateBody(draft({ connectionId: "bedrock" }), STORED);

    expect(body).not.toHaveProperty("restrictions");
  });

  it("sends a changed parameter on its own, with no binding attached", () => {
    const body = updateBody(draft({ params: { thinking: "std", token_budget: 400_000 } }), STORED);

    expect(body).toEqual({ params: { thinking: "std", token_budget: 400_000 } });
  });

  it("sends a changed restriction on its own", () => {
    expect(updateBody(draft({ restrictions: { batch_ok: true } }), STORED)).toEqual({
      restrictions: { batch_ok: true },
    });
  });

  it("counts a control typed into and back out of as no change at all", () => {
    // Two documents with the same entries in a different order are one document; a form that
    // compared serialisations would offer to write a revision that changed nothing.
    const reordered = { token_budget: 400_000, thinking: "max" };

    expect(isDirty(draft({ params: reordered }), STORED)).toBe(false);
  });

  it("trims the name and the model on the way out, and not before", () => {
    expect(updateBody(draft({ alias: "  coder-max  " }), STORED)).toEqual({});
    expect(updateBody(draft({ alias: " coder-dev " }), STORED).alias).toBe("coder-dev");
    expect(updateBody(draft({ modelId: " claude-opus-5 " }), STORED).modelId).toBe("claude-opus-5");
  });

  it("sends a null connection as a value, because unbinding is a request of its own", () => {
    // `connectionId: null` is *unbind*; saying nothing about the binding is a different write.
    const body = updateBody(draft({ connectionId: null }), STORED);

    expect(body.connectionId).toBeNull();
    expect("connectionId" in body).toBe(true);
  });

  it("knows nothing about any particular parameter", () => {
    // The whole claim of the schema endpoint: a new adapter arrives with a working form and no
    // UI written for it. This document names a tunable no adapter in this build has.
    const exotic = { nucleus_sampling: 0.87, beam_width: 4 };
    const body = updateBody(draft({ params: exotic }), { ...STORED, params: {} });

    expect(body.params).toEqual(exotic);
  });
});

describe("the name, and the guard on it", () => {
  it("does not accuse an alias of taking its own name", () => {
    const names = seededRegistry().map((alias) => alias.alias);

    expect(nameProblem("coder-max", names)).toBe("taken");
    expect(nameProblem("coder-max", otherNames(names, "coder-max"))).toBeNull();
  });

  it("still refuses a name another alias has", () => {
    const names = seededRegistry().map((alias) => alias.alias);

    expect(nameProblem("sizer", otherNames(names, "coder-max"))).toBe("taken");
  });

  it("says the rule before the field is touched, in the issue's own words", () => {
    expect(renameBlocked(REFERENCES)).toBe(true);
    expect(renameGuardNote(REFERENCES.length)).toBe(
      "referenced — rename is blocked while 4 references exist",
    );
  });

  it("agrees with itself about one reference", () => {
    expect(renameGuardNote(1)).toBe("referenced — rename is blocked while 1 reference exists");
  });

  it("says nothing at all for an alias nothing references", () => {
    expect(renameGuardNote(0)).toBeNull();
    expect(renameBlocked([])).toBe(false);
  });

  it("names the work list by kind, so a reader knows what to repoint", () => {
    expect(referenceSummary(REFERENCES)).toBe("3 routes and 1 escalation rule");
    expect(referenceSummary([])).toBeNull();
  });
});

describe("why the foot cannot act", () => {
  it("tells a member about their role before anything else", () => {
    expect(saveReason(draft({ alias: "" }), STORED, "empty", REFERENCES, false)).toBe(
      INSPECTOR_READ_ONLY,
    );
  });

  it("asks for a usable name before it looks at the guard", () => {
    expect(saveReason(draft({ alias: "Coder Max" }), STORED, "shape", REFERENCES, true)).toBe(
      NEEDS_NAME,
    );
  });

  it("refuses a rename of a referenced alias before a round trip is spent on it", () => {
    expect(saveReason(draft({ alias: "coder-dev" }), STORED, null, REFERENCES, true)).toBe(
      RENAME_BLOCKED,
    );
  });

  it("allows the same rename once nothing references the alias", () => {
    expect(saveReason(draft({ alias: "coder-dev" }), STORED, null, [], true)).toBeUndefined();
  });

  it("asks for a model", () => {
    expect(saveReason(draft({ modelId: "  " }), STORED, null, [], true)).toBe(NEEDS_MODEL);
  });

  it("stays inert while there is nothing to write", () => {
    expect(saveReason(draft(), STORED, null, REFERENCES, true)).toBe(NOTHING_TO_SAVE);
  });

  it("lets a rebind through", () => {
    expect(saveReason(draft({ connectionId: "bedrock" }), STORED, null, REFERENCES, true))
      .toBeUndefined();
  });
});

describe("the blocked Remove", () => {
  it("is the mockup's line, with the row's own count in it", () => {
    expect(removeWhy(REFERENCES.length)).toBe("blocked — 4 routes reference this alias");
    expect(MOCKUP).toContain("blocked — 4 routes reference this alias");
  });

  it("agrees the verb with the count rather than reading as a template", () => {
    expect(removeWhy(1)).toBe("blocked — 1 route references this alias");
    expect(removeWhy(2)).toBe("blocked — 2 routes reference this alias");
  });

  it("says nothing for an alias that may be removed, which is what enables the button", () => {
    expect(removeWhy(0)).toBeNull();
  });

  it("labels the three controls as the mockup does", () => {
    for (const label of [SAVE_LABEL, "Duplicate", REMOVE_LABEL]) {
      expect(MOCKUP, label).toContain(`>${label}<`);
    }
  });
});

describe("the used-by chips", () => {
  it("sends a route chip to the routing matrix and a rule chip to the rules card", () => {
    const [route] = REFERENCES;
    const rule = REFERENCES.find((reference) => reference.kind === "escalation");

    expect(route && referenceHref(route)).toBe(`${MODELS_PATH}#${ROUTING_MATRIX_HASH}`);
    expect(rule && referenceHref(rule)).toBe(`${MODELS_PATH}#${ROUTING_RULES_HASH}`);
  });

  it("navigates nowhere for a kind whose surface this build does not have", () => {
    // `workflow` and `chat_pin` are declared and contribute nothing until their storage exists;
    // a chip that navigated to a page that is not there would be worse than one that does not.
    for (const kind of ["workflow", "chat_pin"] as const) {
      expect(
        referenceHref({ kind, refId: "r", label: "somewhere", blocking: false }),
        kind,
      ).toBeNull();
    }
  });

  it("covers every kind the contract declares, so a fifth is a build error rather than a gap", () => {
    expect([...REFERENCE_KINDS].sort()).toEqual(
      ["chat_pin", "escalation", "route", "workflow"],
    );
  });

  it("draws the mockup's own four chips for the seeded row", () => {
    for (const reference of REFERENCES) {
      expect(MOCKUP, reference.label).toContain(reference.label);
    }
  });
});

describe("the provider select's options", () => {
  it("names the connection and the key it uses, as the mockup's option does", () => {
    expect(providerOption({ id: "a", name: "Anthropic", mask: "••••Xq4A" })).toBe(
      "Anthropic — key ••••Xq4A",
    );
    // The drawing says `sk-ant-…Xq4A`; the only masked form this product publishes is the
    // service's, and the question the option answers — *which key is this* — is answered either
    // way with a string no page composed.
    expect(MOCKUP).toContain("key sk-ant-…Xq4A");
  });

  it("says so plainly for a connection that stores no credential", () => {
    expect(providerOption({ id: "b", name: "Ollama · workstation", mask: null })).toBe(
      `Ollama · workstation — ${NO_KEY_STORED}`,
    );
  });

  it("says the same sentence about where connections come from as the create dialog", () => {
    expect(PROVIDER_HINT_TEXT).toBe(PROVIDER_HINT);
    expect(MOCKUP).toContain("Providers &amp; keys");
  });
});

describe("the field labels and hints the mockup writes down", () => {
  it("reuses the create dialog's, because they are the same fields", () => {
    // The mockup's inspector is where these were written; the dialog restates them. One string
    // per sentence is what keeps the two surfaces from drifting.
    expect(MOCKUP).toContain(`>${NAME_LABEL}<`);
    expect(MOCKUP).toContain(NAME_HINT);
  });

  it("explains a model the connection has not reported, rather than dropping it", () => {
    expect(unlistedNote("claude-fable-5")).toMatch(/^claude-fable-5 is not in this connection/);
  });
});

describe("what a refused save says", () => {
  it("puts a blocked rename under the name box and under the form", () => {
    const failure = saveFailure({ code: "model_alias_rename_blocked", message: "no", details: {} });

    expect(failure.alias).toBe(RENAME_BLOCKED);
    expect(failure.message).toContain(RENAME_BLOCKED);
    expect(failure.message).toContain("Nothing was changed.");
  });

  it("puts a taken name under the name box", () => {
    const failure = saveFailure({ code: "model_alias_name_taken", message: "no", details: {} });

    expect(failure.alias).toBe(NAME_TAKEN);
  });

  it("puts each parameter refusal on the control that produced it, section by section", () => {
    const failure = saveFailure(
      { code: "model_alias_params_invalid", message: "no", details: {} },
      { thinking: ["Not supported."] },
      { batch_ok: ["Not allowed here."] },
    );

    expect(failure.message).toBe(PARAMS_INVALID);
    expect(failure.params).toEqual({ thinking: ["Not supported."] });
    expect(failure.restrictions).toEqual({ batch_ok: ["Not allowed here."] });
  });

  it("puts a malformed body's field messages under their own fields", () => {
    const failure = saveFailure({
      code: "validation_failed",
      message: "no",
      details: { modelId: ["Must not be empty."], alias: "Bad name." },
    });

    expect(failure.message).toBe(SAVE_INVALID);
    expect(failure.modelId).toBe("Must not be empty.");
    expect(failure.alias).toBe("Bad name.");
    expect(failure.connectionId).toBeUndefined();
  });

  it("puts an unbound enable on the provider select, which is where the fix is", () => {
    const failure = saveFailure({ code: "model_alias_unbound", message: "no", details: {} });

    expect(failure.connectionId).toBe(SAVE_UNBOUND);
  });

  it("says the role refusal without marking any field, because there is nothing to correct", () => {
    const failure = saveFailure({ code: "forbidden", message: "no", details: {} });

    expect(failure.message).toBe(SAVE_READ_ONLY);
    expect(failure.alias).toBeUndefined();
    expect(failure.params).toEqual({});
  });

  it("tells a card whose alias has gone to reload", () => {
    expect(saveFailure({ code: "model_alias_not_found", message: "no", details: {} }).message)
      .toBe(ALIAS_GONE);
  });

  it("keeps the service's own sentence for a code it has none for", () => {
    const failure = saveFailure({ code: "teapot", message: "Upstream is a teapot.", details: {} });

    expect(failure.message).toContain("Upstream is a teapot.");
    expect(failure.message).toContain("Nothing was changed.");
  });
});

describe("what a refused duplicate or remove says", () => {
  it("explains a copy nothing could be named", () => {
    expect(
      duplicateFailure({
        code: "model_alias_copy_name_too_long",
        message: "no",
        details: { proposed: "x-copy" },
      }),
    ).toBe(COPY_TOO_LONG);
  });

  it("tells a member who reached either write anyway", () => {
    expect(duplicateFailure({ code: "forbidden", message: "no", details: {} })).toBe(
      DUPLICATE_READ_ONLY,
    );
    expect(removeFailure({ code: "forbidden", message: "no", details: {} })).toBe(
      REMOVE_READ_ONLY,
    );
  });

  it("names the service's own referrers when a delete is refused, not the card's", () => {
    // A `409` reaching the card means the references changed under the reader, so the sentence
    // has to describe what the service just found rather than what the row was drawn from.
    const message = removeFailure({
      code: "model_alias_referenced",
      message: "no",
      details: { references: REFERENCES },
    });

    expect(message).toContain("3 routes and 1 escalation rule");
    expect(message).toContain("Nothing was changed.");
  });

  it("still says what happened when the refusal describes no referrers it can read", () => {
    const message = removeFailure({
      code: "model_alias_referenced",
      message: "no",
      details: { references: "not a list" },
    });

    expect(message).toContain("Something references this alias");
    expect(message).not.toContain("Repoint the");
  });
});

describe("what the card says while it is writing", () => {
  it("has a line for each of the three writes, so a press is never silent", () => {
    expect(Object.keys(WRITE_LABELS).sort()).toEqual(["duplicate", "remove", "save"]);
    for (const [write, label] of Object.entries(WRITE_LABELS)) {
      expect(label, write).toMatch(/…$/);
    }
  });
});
