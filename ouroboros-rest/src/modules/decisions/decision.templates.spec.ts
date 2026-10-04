import {
  DecisionTemplateError,
  escapeHtml,
  escapeMarkdown,
  renderDecision,
  renderTemplate,
  templateSlots,
  templateWellFormed,
} from "./decision.templates";
import { FIXTURE_KIND, MOCKUP_PROSE, SEEDED_PAYLOADS, SHIPPED_KINDS } from "./decision.kinds.fixture";

/** Template rendering (X2, #461): typed slots, one pass, the mockup's prose, safe per destination. */

describe("renderDecision on the seeded payloads", () => {
  it.each(Object.keys(SHIPPED_KINDS))("renders %s's question, why and tags exactly", (kindId) => {
    expect(renderDecision(SHIPPED_KINDS[kindId], SEEDED_PAYLOADS[kindId])).toEqual(
      MOCKUP_PROSE[kindId],
    );
  });

  it("renders a kind no migration declares, from its own declaration alone", () => {
    expect(
      renderDecision(FIXTURE_KIND, { rig: "helios-rig-02", minutes: 20, drift_c: 1.5 }),
    ).toEqual({
      question: "Let the oven at helios-rig-02 run 20 minutes over?",
      why: "helios-rig-02 drifted 1.5°C off its setpoint; extending lets the soak finish.",
      tags: ["helios-rig-02", "farm"],
    });
  });
});

describe("renderTemplate", () => {
  it("prints a fact that looks like a slot, never expanding it", () => {
    expect(renderTemplate("{a} and {b}", { a: "{b}", b: "x" })).toBe("{b} and x");
  });

  it("prints numbers and booleans as PostgreSQL's ->> does", () => {
    expect(renderTemplate("{n}/{f}/{t}", { n: 14, f: 2.5, t: true })).toBe("14/2.5/true");
  });

  it("refuses a slot with no fact, or a fact that is not a scalar", () => {
    expect(() => renderTemplate("{missing}", {})).toThrow(DecisionTemplateError);
    expect(() => renderTemplate("{x}", { x: null })).toThrow(/has no fact/);
    expect(() => renderTemplate("{x}", { x: { nested: 1 } })).toThrow(/has no fact/);
    expect(() => renderTemplate("{x}", { x: [1] })).toThrow(/has no fact/);
  });

  it("refuses a malformed template rather than printing a stray brace", () => {
    expect(() => renderTemplate("a { b", {})).toThrow(/malformed/);
    expect(() => renderTemplate("{Upper}", { Upper: "x" })).toThrow(/malformed/);
  });

  it("escapes the whole result for HTML and for Markdown destinations", () => {
    const payload = { claim: "<script>alert('x')</script> & *bold*" };

    expect(renderTemplate("“{claim}”", payload, "html")).toBe(
      "“&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; *bold*”",
    );
    expect(renderTemplate("{claim}", payload, "markdown")).toBe(
      "&lt;script&gt;alert\\('x'\\)&lt;/script&gt; & \\*bold\\*",
    );
  });
});

describe("the slot grammar", () => {
  it("lists slots in order, repeats kept", () => {
    expect(templateSlots("{a} {b} {a}")).toEqual(["a", "b", "a"]);
    expect(templateSlots("no slots")).toEqual([]);
  });

  it("knows a well-formed template from one with a stray brace", () => {
    expect(templateWellFormed("Approve merge for a {pr_kind} PR?")).toBe(true);
    expect(templateWellFormed("}{")).toBe(false);
  });
});

describe("escaping", () => {
  it("covers every character HTML reads as markup", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("backslashes Markdown's punctuation and entity-encodes angle brackets", () => {
    expect(escapeMarkdown("# [x](y) _z_ <b>")).toBe("\\# \\[x\\]\\(y\\) \\_z\\_ &lt;b&gt;");
  });
});
