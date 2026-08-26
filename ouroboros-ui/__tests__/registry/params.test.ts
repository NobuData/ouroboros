import { describe, expect, it } from "vitest";

import {
  PARAM_REASONS,
  PROVIDER_DEFAULT,
  documentsEqual,
  paramDefaults,
  paramFieldErrors,
  paramHint,
  paramValue,
  paramValues,
  paramsDocument,
  paramsNote,
} from "@/app/registry/params";

import { budgetField, paramField, paramSection } from "../helpers/registry";

/**
 * The registry's parameter form, as decisions (#594, over CH.2's schema, #585).
 *
 * Three properties are worth a suite of their own, and each is a way a form over somebody
 * else's schema goes wrong while looking right:
 *
 * 1. **A blank control sends nothing.** `defaultValue` is documented as *not a value this
 *    product sends*: an alias whose `params` omits a key takes the provider's own default. A
 *    form that pre-filled the box would quietly pin every new alias to whatever this build's
 *    adapter happened to suggest, and nobody would ever see it happen.
 * 2. **A value is typed as the field says.** `integer` is a separate widget from `number`
 *    because `4096.5` is a token budget no provider accepts, and a client that sent the string
 *    `"400000"` where a number belongs would be refused by field with a message about a shape
 *    the reader never chose.
 * 3. **An empty form explains itself.** Three honest reasons, none of them an error, and each a
 *    different sentence — a form that said nothing would be indistinguishable from one that
 *    failed to load.
 *
 * CI.3 ([#593](https://github.com/NobuData/ouroboros/issues/593)) adds the counterpart to the
 * first: the inspector opens on **what is stored**, because that is what it is editing, and the
 * two forms differ in that one decision and nowhere else. A fourth property comes with it —
 * *a control typed into and typed back out of is not a change* — which is what
 * {@link documentsEqual} answers and what keeps a dirty-aware Save from offering to write a
 * revision nothing asked for.
 */

describe("what a fresh form starts in", () => {
  it("gives every field an entry, so no control is uncontrolled on its first render", () => {
    // A control that is uncontrolled once and controlled next render is React's own warning and
    // a real bug when the model changes under a form that is already open.
    expect(paramDefaults([paramField(), budgetField()])).toEqual({
      thinking: "",
      token_budget: "",
    });
  });

  it("starts every control empty, whatever default the field carries", () => {
    // The whole of property 1. `off` is the adapter's suggestion, not this product's value.
    const suggested = paramField({ defaultValue: "off" });

    expect(paramDefaults([suggested])).toEqual({ thinking: "" });
  });

  it("starts a switch off, because that is what an absent boolean means", () => {
    expect(paramDefaults([paramField({ name: "batch_ok", widget: "switch", choices: null })])).toEqual({
      batch_ok: false,
    });
  });
});

describe("one field's value", () => {
  it("is undefined for a control nobody touched, so the key stays out of the document", () => {
    expect(paramValue(paramField(), "")).toBeUndefined();
    expect(paramValue(paramField(), undefined)).toBeUndefined();
    expect(paramValue(budgetField(), "   ")).toBeUndefined();
  });

  it("is the string a select or a text box holds", () => {
    expect(paramValue(paramField(), "max")).toBe("max");
  });

  it("is a number for the two numeric widgets, not the string that was typed", () => {
    expect(paramValue(budgetField(), "400000")).toBe(400_000);
    expect(paramValue(paramField({ name: "temperature", widget: "number", choices: null }), "0.2")).toBe(0.2);
  });

  it("refuses a fraction where the service asked for an integer", () => {
    // The contract splits `integer` from `number` for exactly this: a token budget of 4096.5 is
    // a value no provider accepts.
    expect(paramValue(budgetField(), "4096.5")).toBeUndefined();
  });

  it("refuses a word where a number belongs, rather than sending NaN", () => {
    expect(paramValue(budgetField(), "lots")).toBeUndefined();
  });

  it("sends a switch only when it is on", () => {
    // `false` is the absence of the key, not a value to store: an alias that says nothing about
    // a flag is not an alias that says the flag is off.
    const flag = paramField({ name: "batch_ok", widget: "switch", choices: null });

    expect(paramValue(flag, true)).toBe(true);
    expect(paramValue(flag, false)).toBeUndefined();
  });
});

describe("the document a form produces", () => {
  it("is empty for a form nobody touched", () => {
    // Which is the same as what an untouched import row sends, and the right answer: the
    // provider's own defaults.
    const fields = [paramField(), budgetField()];

    expect(paramsDocument(fields, paramDefaults(fields))).toEqual({});
  });

  it("carries only the controls that were filled in, typed", () => {
    expect(
      paramsDocument([paramField(), budgetField()], { thinking: "max", token_budget: "400000" }),
    ).toEqual({ thinking: "max", token_budget: 400_000 });
  });

  it("ignores a value held for a field this model does not have", () => {
    // The field set is replaced whenever the model is, and the document is built from the
    // fields on the screen rather than from whatever state happens to be left over.
    expect(paramsDocument([paramField()], { thinking: "max", context_clamp: "8192" })).toEqual({
      thinking: "max",
    });
  });
});

describe("the line under a control", () => {
  it("carries the field's own help", () => {
    expect(paramHint(paramField())).toContain("deliberate");
  });

  it("names the bounds, so a refusal from the browser is not a surprise", () => {
    expect(paramHint(budgetField())).toContain("1–400000");
  });

  it("says one bound where there is only one", () => {
    expect(paramHint(paramField({ help: null, minimum: 1, maximum: null }))).toBe("at least 1");
    expect(paramHint(paramField({ help: null, minimum: null, maximum: 8 }))).toBe("at most 8");
  });

  it("introduces the default as the provider's, because that is whose it is", () => {
    // It is what happens when this product sends nothing — a fact about the provider rather
    // than a value the box is pre-set to.
    expect(paramHint(paramField({ help: null, defaultValue: "std" }))).toBe(
      `${PROVIDER_DEFAULT} std`,
    );
  });

  it("is null for a field with nothing to add to its label", () => {
    expect(paramHint(paramField({ help: null }))).toBeNull();
  });
});

describe("what an empty section says", () => {
  it("prefers the service's own description, which was written about this exact model", () => {
    const section = paramSection([], "Nothing to tune", "This provider publishes no parameters.");

    expect(paramsNote(section, "provider_has_no_parameters")).toBe(
      "This provider publishes no parameters.",
    );
  });

  it("falls back to the product's sentence for the reason, when the schema carried none", () => {
    expect(paramsNote(paramSection([], "Nothing to tune"), "alias_unbound")).toBe(
      PARAM_REASONS.alias_unbound,
    );
  });

  it("says nothing at all when there are fields to draw instead", () => {
    expect(paramsNote(paramSection([paramField()]), null)).toBeNull();
  });

  it("gives the three honest cases three distinct sentences, and calls none of them an error", () => {
    const sentences = Object.values(PARAM_REASONS);

    expect(new Set(sentences).size).toBe(3);
    for (const sentence of sentences) expect(sentence, sentence).not.toMatch(/error|failed/i);
  });

  it("tells an unbound alias that its parameters can be set once it is bound", () => {
    // The *bind later* mode creates exactly this state on purpose, so the sentence has to read
    // as a consequence somebody chose rather than as something that went wrong.
    expect(PARAM_REASONS.alias_unbound).toMatch(/once the alias is bound/);
  });
});

describe("a refusal's field paths", () => {
  it("takes the document's prefix off, so a field finds its own message by name", () => {
    expect(
      paramFieldErrors({ "params.thinking": ["thinking must be one of off, std, max"] }, "params"),
    ).toEqual({ thinking: ["thinking must be one of off, std, max"] });
  });

  it("drops another document's paths rather than drawing them on this one's fields", () => {
    // An error about `restrictions.batch_ok` under the `thinking` select would be worse than
    // one drawn nowhere; the dialog's whole-form sentence catches whatever finds no field.
    expect(
      paramFieldErrors({ "restrictions.batch_ok": ["nope"], "params.thinking": ["no"] }, "params"),
    ).toEqual({ thinking: ["no"] });
  });

  it("reads a lone string as one sentence rather than as a character array", () => {
    expect(paramFieldErrors({ "params.thinking": "not allowed" }, "params")).toEqual({
      thinking: ["not allowed"],
    });
  });

  it("ignores anything that is not a sentence, rather than rendering its own confusion", () => {
    expect(paramFieldErrors({ "params.thinking": { nested: true } }, "params")).toEqual({});
    expect(paramFieldErrors({ "params.thinking": [1, 2] }, "params")).toEqual({});
  });

  it("finds nothing in a refusal that named no field", () => {
    expect(paramFieldErrors({}, "params")).toEqual({});
    expect(paramFieldErrors({ alias: ["taken"] }, "params")).toEqual({});
  });
});

describe("what an editing form starts in", () => {
  it("prefills every control from what the alias has stored", () => {
    // The counterpart of `paramDefaults`, and the one decision the two forms differ in: a create
    // dialog has nothing stored yet, an inspector is editing what is.
    expect(paramValues([paramField(), budgetField()], { thinking: "max", token_budget: 400_000 })).toEqual(
      { thinking: "max", token_budget: "400000" },
    );
  });

  it("leaves a control empty for a key the stored document says nothing about", () => {
    // An alias that says nothing about `thinking` must open with a blank select rather than
    // with a value nobody wrote — the same rule the create dialog keeps for every field.
    expect(paramValues([paramField(), budgetField()], { token_budget: 1000 })).toEqual({
      thinking: "",
      token_budget: "1000",
    });
  });

  it("gives every field an entry, so no control is uncontrolled on its first render either", () => {
    expect(Object.keys(paramValues([paramField(), budgetField()], {}))).toEqual([
      "thinking",
      "token_budget",
    ]);
  });

  it("reads a stored null as *nothing was said*, which is what an absent key means", () => {
    expect(paramValues([paramField()], { thinking: null })).toEqual({ thinking: "" });
  });

  it("takes a switch's position from the stored boolean, and only from a true one", () => {
    const flag = paramField({ name: "batch_ok", label: "Batch ok", widget: "switch", choices: null });

    expect(paramValues([flag], { batch_ok: true })).toEqual({ batch_ok: true });
    expect(paramValues([flag], { batch_ok: "yes" })).toEqual({ batch_ok: false });
    expect(paramValues([flag], {})).toEqual({ batch_ok: false });
  });

  it("opens blank on a value no control could edit, rather than on `[object Object]`", () => {
    expect(paramValues([budgetField()], { token_budget: { min: 1 } })).toEqual({
      token_budget: "",
    });
  });

  it("round-trips what is stored back into the same document, so an untouched form is clean", () => {
    // The property the whole prefill exists for: opening a card must not make it dirty.
    const fields = [paramField(), budgetField()];
    const stored = { thinking: "max", token_budget: 400_000 };

    expect(paramsDocument(fields, paramValues(fields, stored))).toEqual(stored);
  });

  it("drops a stored key the current schema has no control for", () => {
    // A model that cannot honour a parameter has no field for it, so the form neither shows it
    // nor claims it — which is exactly what a rebind has to send.
    const fields = [budgetField()];
    const stored = { thinking: "max", token_budget: 400_000 };

    expect(paramsDocument(fields, paramValues(fields, stored))).toEqual({ token_budget: 400_000 });
  });
});

describe("whether two documents say the same thing", () => {
  it("ignores the order the keys arrived in, because two objects are not two documents", () => {
    expect(documentsEqual({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
  });

  it("sees a changed value", () => {
    expect(documentsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it("sees a key one of them does not have, in either direction", () => {
    expect(documentsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(documentsEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("does not confuse a number with the string of it, which is what the typing is for", () => {
    expect(documentsEqual({ a: 1 }, { a: "1" })).toBe(false);
  });

  it("calls two empty documents equal, which is the ordinary untouched case", () => {
    expect(documentsEqual({}, {})).toBe(true);
  });
});
