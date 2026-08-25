import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/app/api/errors";
import {
  RULE_FORBIDDEN,
  RULE_GONE,
  RULE_WRITE_FAILURE,
  TARGETS_UNAVAILABLE,
} from "@/app/models/rules";

import { seededAliases, seededRules } from "../helpers/models";

/**
 * The rules card's server hop (#204) — the only writes the routing page makes.
 *
 * A Server Action is a POST endpoint anybody can reach, so every action suite in this module
 * is written as the security case first: **there is no workspace in any call and no person**,
 * so there is nothing to forge, and the role gate is the service's — a member who reaches a
 * write anyway gets its `403`, which comes back as the sentence the card would have shown.
 * The rest is the posture: a refusal is a value the card can draw, and the gate's redirect is
 * the one throw that must travel.
 */

/** What the API answers, per case and per call. */
const changeRule = vi.fn();
const addRule = vi.fn();
const removeRule = vi.fn();
const aliases = vi.fn();

vi.mock("@/app/api/routing", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/routing")>("@/app/api/routing");

  return {
    ...actual,
    routing: {
      ...actual.routing,
      changeRule: (id: string, change: unknown) => changeRule(id, change),
      addRule: (rule: unknown) => addRule(rule),
      removeRule: (id: string) => removeRule(id),
      aliases: () => aliases(),
    },
  };
});

// The routing facade is `server-only` and sits on the server-side client, whose own imports
// are the three every server-side suite answers.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

const actions = await import("@/app/models/rule-actions");

/** The seed's first rule. */
const RULE = seededRules()[0];

/** The refusal a member meets. */
const FORBIDDEN = new ApiError(403, "forbidden", "Your role does not permit this.");

/** The refusal for a rule somebody else removed first. */
const GONE = new ApiError(404, "escalation_rule_not_found", "No such rule.");

/** A refusal with the service's own sentence, which the card passes on. */
const INVALID = new ApiError(422, "escalation_rule_invalid", "then: names an alias this workspace does not have.");

beforeEach(() => {
  changeRule.mockReset().mockResolvedValue({ ...RULE, enabled: false });
  addRule.mockReset().mockResolvedValue(RULE);
  removeRule.mockReset().mockResolvedValue(undefined);
  aliases.mockReset().mockResolvedValue(seededAliases());
});

describe("setRuleEnabled", () => {
  it("sends the one rule's id and the position to move to, and nothing else", async () => {
    // No workspace and no person: the rule belongs to the workspace the session is acting
    // in, and `{ enabled }` never resends a predicate.
    await actions.setRuleEnabled(RULE.id, false);

    expect(changeRule).toHaveBeenCalledExactlyOnceWith(RULE.id, { enabled: false });
  });

  it("answers ok when the write landed", async () => {
    await expect(actions.setRuleEnabled(RULE.id, false)).resolves.toEqual({ ok: true });
  });

  it("turns a member's 403 into the card's own sentence", async () => {
    changeRule.mockRejectedValue(FORBIDDEN);

    await expect(actions.setRuleEnabled(RULE.id, false)).resolves.toEqual({
      ok: false,
      reason: RULE_FORBIDDEN,
    });
  });

  it("says a rule somebody else removed is gone", async () => {
    changeRule.mockRejectedValue(GONE);

    await expect(actions.setRuleEnabled(RULE.id, true)).resolves.toEqual({
      ok: false,
      reason: RULE_GONE,
    });
  });

  it("passes any other refusal on in the service's words", async () => {
    changeRule.mockRejectedValue(INVALID);

    await expect(actions.setRuleEnabled(RULE.id, true)).resolves.toEqual({
      ok: false,
      reason: INVALID.message,
    });
  });

  it("supplies a sentence for a refusal that carried none", async () => {
    changeRule.mockRejectedValue(new ApiError(500, "internal_error", ""));

    await expect(actions.setRuleEnabled(RULE.id, true)).resolves.toEqual({
      ok: false,
      reason: RULE_WRITE_FAILURE,
    });
  });

  it("lets the gate's redirect through rather than drawing it as a refusal", async () => {
    // A session that expired since the page rendered still reaches the login screen.
    changeRule.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(actions.setRuleEnabled(RULE.id, true)).rejects.toThrow("NEXT_REDIRECT /login");
  });
});

describe("addRule", () => {
  it("forwards the structure the builder composed, unchanged", async () => {
    const rule = { when: RULE.when, then: RULE.then };

    await expect(actions.addRule(rule)).resolves.toEqual({ ok: true });

    expect(addRule).toHaveBeenCalledExactlyOnceWith(rule);
  });

  it("turns a member's 403 into the card's own sentence", async () => {
    addRule.mockRejectedValue(FORBIDDEN);

    await expect(actions.addRule({ when: RULE.when, then: RULE.then })).resolves.toEqual({
      ok: false,
      reason: RULE_FORBIDDEN,
    });
  });

  it("passes the grammar's refusal on in the service's words, so the builder can show it", async () => {
    addRule.mockRejectedValue(INVALID);

    await expect(actions.addRule({ when: RULE.when, then: RULE.then })).resolves.toEqual({
      ok: false,
      reason: INVALID.message,
    });
  });
});

describe("removeRule", () => {
  it("sends the one rule's id", async () => {
    await expect(actions.removeRule(RULE.id)).resolves.toEqual({ ok: true });

    expect(removeRule).toHaveBeenCalledExactlyOnceWith(RULE.id);
  });

  it("turns a member's 403 into the card's own sentence", async () => {
    removeRule.mockRejectedValue(FORBIDDEN);

    await expect(actions.removeRule(RULE.id)).resolves.toEqual({ ok: false, reason: RULE_FORBIDDEN });
  });

  it("says a rule already removed is gone", async () => {
    removeRule.mockRejectedValue(GONE);

    await expect(actions.removeRule(RULE.id)).resolves.toEqual({ ok: false, reason: RULE_GONE });
  });
});

describe("readRuleTargets", () => {
  it("reads the registry list and labels every alias with its resolution line", async () => {
    const reading = await actions.readRuleTargets();

    expect(reading.ok).toBe(true);
    if (reading.ok) {
      expect(reading.aliases).toHaveLength(8);
      expect(reading.aliases[1]).toEqual({
        alias: "coder-max",
        resolution: "claude-fable-5 · Anthropic Claude",
        providerId: "5eed000c-0000-4000-8000-000000000001",
      });
      expect(reading.aliases[3]).toEqual({
        alias: "gpt5-experiments",
        resolution: "gpt-5 · no provider",
        providerId: null,
      });
    }
  });

  it("reads a workspace with no aliases as an empty list rather than a failure", async () => {
    aliases.mockResolvedValue([]);

    await expect(actions.readRuleTargets()).resolves.toEqual({ ok: true, aliases: [] });
  });

  it("answers a refusal with the builder's sentence", async () => {
    aliases.mockRejectedValue(new ApiError(500, "internal_error", "Boom."));

    await expect(actions.readRuleTargets()).resolves.toEqual({
      ok: false,
      reason: TARGETS_UNAVAILABLE,
    });
  });

  it("lets the gate's redirect through", async () => {
    aliases.mockRejectedValue(new Error("NEXT_REDIRECT /login"));

    await expect(actions.readRuleTargets()).rejects.toThrow("NEXT_REDIRECT /login");
  });
});
