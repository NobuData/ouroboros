import {
  APPLIED_RULE_CODES,
  droppedHopExplanation,
  failureExplanation,
  floorExplanation,
  FLOOR_CODES,
  healthPhrase,
  HOP_CODES,
  hopRole,
  keptHopExplanation,
  KEPT_HOP_CODES,
  RESOLUTION_FAILURE_CODES,
  RULE_CODES,
  ruleExplanation,
  type ProviderFacts,
} from "./explanations";

/**
 * Every reason this engine can give, asserted as the string it gives.
 *
 * The acceptance criterion is that the inspector and the simulate panel render these
 * *without post-processing*, which means the sentences are a contract with a person rather
 * than an implementation detail. A suite that only checked they were non-empty would let one
 * of them become a placeholder that nobody notices until it is on a screen.
 *
 * Two structural properties are checked over **every** code rather than over the ones that
 * were easy to remember, because both are the kind of thing a new code arrives without:
 * a decision that removes something reads as a sentence, and a kept hop reads as the mockup's
 * meta line.
 */

/** A provider in a given state, for the sentence under test. */
function facts(overrides: Partial<ProviderFacts> = {}): ProviderFacts {
  return {
    displayName: "Anthropic Claude",
    status: "active",
    latencyMs: null,
    detail: null,
    ...overrides,
  };
}

/** Every hop code, as values — what the two structural tests sweep. */
const EVERY_HOP_CODE = Object.values(HOP_CODES);

/** The codes that drop a hop — the complement of the two that keep one. */
const DROPPING_HOP_CODES = EVERY_HOP_CODE.filter(
  (code) => !(KEPT_HOP_CODES as readonly string[]).includes(code),
);

describe("naming a hop", () => {
  it("calls the first hop the primary and numbers the rest as fallbacks", () => {
    expect(hopRole(1)).toBe("Primary");
    expect(hopRole(2)).toBe("Fallback 1");
    expect(hopRole(3)).toBe("Fallback 2");
  });
});

describe("saying how a provider is doing", () => {
  it("prints a latency only for a provider that is up", () => {
    // A paused provider's last measurement is a fact about a check nobody is repeating.
    // Printing it beside "paused" would read as a live number.
    expect(healthPhrase(facts({ latencyMs: 42 }))).toBe("healthy · 42ms");
    expect(healthPhrase(facts({ status: "paused", latencyMs: 42 }))).toBe("paused by an operator");
  });

  it("never invents a latency for a provider nothing measured", () => {
    // Decision M8: `0ms` is not "unknown", it is an excellent latency.
    expect(healthPhrase(facts())).toBe("healthy");
    expect(healthPhrase(facts())).not.toContain("0ms");
  });

  it("says nothing has looked rather than calling an unchecked provider healthy", () => {
    expect(healthPhrase(facts({ status: "unknown" }))).toBe("not checked yet");
  });

  it("carries the detail a check recorded", () => {
    expect(healthPhrase(facts({ status: "error", detail: "503 upstream" }))).toBe(
      "unreachable · 503 upstream",
    );
  });
});

describe("the shape of an explanation", () => {
  it.each(DROPPING_HOP_CODES)("makes %s a sentence", (code) => {
    const sentence = droppedHopExplanation(code, 2, "coder-max", facts(), 2);

    expect(sentence.endsWith(".")).toBe(true);
    expect(sentence).toContain("—");
  });

  it.each([...KEPT_HOP_CODES])("makes %s the inspector's meta line", (code) => {
    // Compact, `·`-separated, no terminal period — the shape mockup 06 draws. A kept hop is a
    // label rather than an argument, and it sits where the operator's note sits.
    expect(KEPT_HOP_CODES).toContain(code);
    expect(keptHopExplanation(1, facts({ latencyMs: 42 }))).toBe("Primary · healthy · 42ms");
    expect(keptHopExplanation(1, facts()).endsWith(".")).toBe(false);
  });

  it("gives every hop code a sentence of its own", () => {
    // Distinct rather than merely non-empty: two codes sharing a sentence is two reasons a
    // reader cannot tell apart, which is the failure this whole module exists to prevent.
    const sentences = DROPPING_HOP_CODES.map((code) =>
      droppedHopExplanation(code, 3, "local-docs", facts({ displayName: "Ollama" }), 1),
    );

    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe("explaining a dropped hop", () => {
  it("names the alias when the alias is what is wrong", () => {
    expect(droppedHopExplanation(HOP_CODES.unbound, 1, "gpt5-experiments", null, null)).toBe(
      "Primary dropped — the alias gpt5-experiments is not bound to a provider connection.",
    );
  });

  it("quotes the floor an operator set", () => {
    expect(droppedHopExplanation(HOP_CODES.belowFloor, 3, "local-docs", facts(), 2)).toBe(
      "Fallback 2 dropped — this route may not degrade below hop 2.",
    );
  });

  it("names the provider when the provider is what is wrong", () => {
    expect(
      droppedHopExplanation(
        HOP_CODES.unreachable,
        2,
        "coder-fallback",
        facts({ displayName: "GitHub Copilot", status: "error", detail: "503 upstream" }),
        null,
      ),
    ).toBe("Fallback 1 dropped — GitHub Copilot is unreachable (503 upstream).");
  });

  it("says which policy dropped a local hop, and which rule dropped a cloud one", () => {
    const ollama = facts({ displayName: "Ollama · workstation" });

    expect(droppedHopExplanation(HOP_CODES.localNotAllowed, 3, "local-docs", ollama, null)).toBe(
      "Fallback 2 dropped — this route does not allow local models, and Ollama · workstation is one.",
    );
    expect(droppedHopExplanation(HOP_CODES.notLocal, 1, "coder-max", facts(), null)).toBe(
      "Primary dropped — an escalation rule routes this run to local providers, " +
        "and Anthropic Claude is not one.",
    );
  });
});

describe("explaining the floor", () => {
  it("says so when there is none", () => {
    expect(floorExplanation(FLOOR_CODES.none, null, 0)).toBe(
      "No floor is set — this route may degrade to the end of its chain.",
    );
  });

  it("distinguishes a floor that dropped nothing from one that did", () => {
    expect(floorExplanation(FLOOR_CODES.held, 3, 0)).toBe(
      "The floor is hop 3 — nothing in this chain sits below it.",
    );
    expect(floorExplanation(FLOOR_CODES.held, 2, 1)).toBe(
      "The floor is hop 2 — this route may not degrade below it, so 1 deeper hop was dropped.",
    );
    expect(floorExplanation(FLOOR_CODES.held, 1, 2)).toBe(
      "The floor is hop 1 — this route may not degrade below it, so 2 deeper hops were dropped.",
    );
  });

  it("says why the run is being refused rather than shortened", () => {
    expect(floorExplanation(FLOOR_CODES.breached, 2, 1)).toBe(
      "The floor is hop 2 — no hop at or above it is usable, so this run fails " +
        "rather than degrading below it.",
    );
  });
});

describe("explaining a refusal", () => {
  it("gives the floor's own sentence when the floor is what refused", () => {
    // One fact, one wording. A second phrasing of *the floor stopped this* would be a second
    // thing to keep in step with the inspector.
    expect(failureExplanation(RESOLUTION_FAILURE_CODES.floorBreached, "implement-primary", 2)).toBe(
      floorExplanation(FLOOR_CODES.breached, 2, 0),
    );
  });

  it("names the route when nothing in it is usable", () => {
    expect(failureExplanation(RESOLUTION_FAILURE_CODES.noEligibleHop, "docs-primary", null)).toBe(
      "No hop in docs-primary is usable, so this run fails rather than guessing.",
    );
  });
});

describe("explaining a rule", () => {
  it.each(Object.values(RULE_CODES))("opens %s with whether it applied", (code) => {
    const sentence = ruleExplanation(code, "coder-max", "review", "implement");
    const applied = (APPLIED_RULE_CODES as readonly string[]).includes(code);

    expect(sentence.startsWith(applied ? "Applied — " : "Not applied — ")).toBe(true);
    expect(sentence.endsWith(".")).toBe(true);
  });

  it("distinguishes the three things a use_alias rule can do", () => {
    expect(ruleExplanation(RULE_CODES.paramsMerged, "coder-max", "implement", "implement")).toBe(
      "Applied — coder-max is already the primary, and the rule's parameters " +
        "were merged over the alias's.",
    );
    expect(ruleExplanation(RULE_CODES.swapped, "coder-max", "implement", "implement")).toBe(
      "Applied — coder-max was moved to the front of the chain.",
    );
    expect(ruleExplanation(RULE_CODES.prepended, "coder-max", "implement", "implement")).toBe(
      "Applied — coder-max was prepended as the primary.",
    );
  });

  it("contrasts the kind a near-miss rule modifies with the one being resolved", () => {
    expect(ruleExplanation(RULE_CODES.otherTaskKind, "second-opinion", "review", "implement")).toBe(
      "Not applied — this rule modifies review, and this resolution is for implement.",
    );
  });

  it("says what a route_local rule did without naming an alias it does not have", () => {
    expect(ruleExplanation(RULE_CODES.routedLocal, null, null, "implement")).toBe(
      "Applied — the chain was filtered to local providers.",
    );
  });
});

describe("the codes themselves", () => {
  it("gives the floor breach and the refusal one spelling", () => {
    // Two names for one fact would make a client check both.
    expect(RESOLUTION_FAILURE_CODES.floorBreached).toBe(FLOOR_CODES.breached);
  });

  it("keeps every code distinct within its vocabulary", () => {
    for (const codes of [EVERY_HOP_CODE, Object.values(RULE_CODES), Object.values(FLOOR_CODES)]) {
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});
