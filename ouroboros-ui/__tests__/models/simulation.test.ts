import { describe, expect, it } from "vitest";

import {
  DECISION_WORD,
  composeSimulation,
  hopResolution,
  initialSimulation,
  outcomeLabel,
  ruleWord,
  splitLabels,
  unsavedNote,
  walkedChain,
} from "@/app/models/simulation";

import { failRunExample, resolvedExample } from "../helpers/models";

/**
 * The simulate panel's decisions (#203): how four inputs become a request, and the few words
 * the panel adds around an answer it otherwise renders verbatim.
 */

/** The seeded kinds, in the matrix's order. */
const KINDS = ["analyze", "estimate", "plan", "implement"] as const;

describe("the opening draft", () => {
  it("opens on the route the panel was opened from, knowing nothing about the work", () => {
    expect(initialSimulation(KINDS, "implement")).toEqual({
      taskKind: "implement",
      effort: "",
      labels: "",
      diffKind: "",
    });
  });

  it("falls back on the matrix's first kind, for the head's button and for a kind the matrix lacks", () => {
    expect(initialSimulation(KINDS).taskKind).toBe("analyze");
    expect(initialSimulation(KINDS, null).taskKind).toBe("analyze");
    expect(initialSimulation(KINDS, "deploy").taskKind).toBe("analyze");
  });

  it("holds an empty kind for a workspace with none, rather than inventing one", () => {
    expect(initialSimulation([]).taskKind).toBe("");
  });
});

describe("the labels", () => {
  it("splits on commas and trims, dropping empties, keeping case and spelling", () => {
    expect(splitLabels("security, Needs-Review ,,bug,")).toEqual(["security", "Needs-Review", "bug"]);
    expect(splitLabels("")).toEqual([]);
    expect(splitLabels(" , ")).toEqual([]);
  });
});

describe("the request", () => {
  it("sends only the task kind when nothing is known — no ctx, no nulls, no defaults", () => {
    // An absent fact is unknown, never small: a context with no effort has not said the work
    // is tiny, and a rule reading `effort_gte: "l"` must not fire on it.
    expect(composeSimulation(initialSimulation(KINDS, "implement"))).toEqual({ taskKind: "implement" });
  });

  it("carries exactly the facts the reader set", () => {
    expect(
      composeSimulation({ taskKind: "implement", effort: "l", labels: "", diffKind: "" }),
    ).toEqual({ taskKind: "implement", ctx: { effort: "l" } });

    expect(
      composeSimulation({ taskKind: "review", effort: "", labels: "security", diffKind: "docs_only" }),
    ).toEqual({ taskKind: "review", ctx: { labels: ["security"], diffKind: "docs_only" } });
  });

  it("never sends null for a fact, which the contract refuses", () => {
    const request = composeSimulation({ taskKind: "plan", effort: "", labels: " , ", diffKind: "" });

    expect(JSON.stringify(request)).not.toContain("null");
    expect(request).toEqual({ taskKind: "plan" });
  });
});

describe("the answer's few words", () => {
  it("prints a hop's resolution the way the matrix prints the alias's", () => {
    const [primary] = resolvedExample().chain;
    const [vote] = resolvedExample().votes;

    expect(hopResolution(primary)).toBe("claude-fable-5 · Anthropic Claude");
    expect(hopResolution(vote)).toBe("claude-opus-5 · Anthropic Claude");
  });

  it("says *no provider* for an unbound alias, as the matrix does", () => {
    const [primary] = resolvedExample().chain;

    expect(hopResolution({ ...primary, provider: null })).toBe("claude-fable-5 · no provider");
  });

  it("filters the walked chain to the kept hops, which the contract leaves to the client", () => {
    expect(walkedChain(resolvedExample()).map((hop) => hop.alias)).toEqual(["coder-max", "coder-std"]);
    expect(walkedChain(failRunExample())).toEqual([]);
  });

  it("names both outcomes as outcomes, and uses the contract's two words for a decision", () => {
    expect(outcomeLabel("resolved")).toBe("Resolved");
    expect(outcomeLabel("fail_run")).toBe("The run fails");
    expect(DECISION_WORD).toEqual({ kept: "kept", dropped: "dropped" });
    expect(ruleWord(true)).toBe("applied");
    expect(ruleWord(false)).toBe("did not apply");
  });

  it("tells the reader the answer is about the routes as saved, in the singular and the plural", () => {
    expect(unsavedNote(1)).toBe(
      "The simulation runs against the routes as saved — the route changed on this page is not part of it until Save routes.",
    );
    expect(unsavedNote(3)).toMatch(/the 3 routes changed on this page are not part of it/);
  });
});
