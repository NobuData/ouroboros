import {
  AUDIT_ACTIONS,
  auditDetail,
  LEASE_GRANTED_EVENT,
  providerUpdateEvent,
  PROVIDER_ADDED_EVENT,
  PROVIDER_CAP_CHANGED_EVENT,
  PROVIDER_DELETED_EVENT,
  PROVIDER_DISABLED_EVENT,
  PROVIDER_ENABLED_EVENT,
  PROVIDER_REVEALED_EVENT,
  PROVIDER_ROTATED_EVENT,
  PROVIDER_TESTED_EVENT,
  PROVIDER_UPDATED_EVENT,
} from "./audit.events";

/**
 * The vocabulary, and the three things it has to be.
 *
 * **AD.4's own names** ([#225](https://github.com/NobuData/ouroboros/issues/225)), spelled
 * as that issue's scope spelled them, so somebody grepping the trail later finds the strings
 * that were agreed rather than ones a module invented. **Storable**, which means every one of
 * them satisfies the grammar V022 constrains the column to — a name this service could write
 * and PostgreSQL would refuse is a credential operation that fails at its last statement.
 * And **decidable**, because a `PATCH` that changed two things must still write exactly one
 * event and the same one every time.
 */

describe("the vocabulary", () => {
  it("is the ten names AD.4 and AD.3 wrote down", () => {
    expect([...AUDIT_ACTIONS]).toEqual([
      "provider.added",
      "provider.revealed",
      "provider.rotated",
      "provider.enabled",
      "provider.disabled",
      "provider.cap_changed",
      "provider.updated",
      "provider.deleted",
      "provider.tested",
      "credential.lease_granted",
    ]);
  });

  it("has no duplicates, so a filter on one name cannot mean two things", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("satisfies the grammar V022 enforces", () => {
    // `family.event`, lower snake on both sides — `audit_events_action_grammar`. Asserted
    // against the same pattern the migration carries, because the two rules are only useful
    // if they agree.
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });

  it("files each event under a family somebody would think to filter on", () => {
    // Nine provider events and one credential-delivery event. The families are what make
    // `action like 'provider.%'` a useful question.
    const families = new Set(AUDIT_ACTIONS.map((action) => action.split(".")[0]));

    expect([...families].sort()).toEqual(["credential", "provider"]);
  });

  it("exports every name individually as well as in the list", () => {
    // The list is what a filter validates against; the constants are what the writers use. A
    // name in one and not the other is an event that can be written and not filtered for, or
    // filtered for and never written.
    const named = [
      PROVIDER_ADDED_EVENT,
      PROVIDER_REVEALED_EVENT,
      PROVIDER_ROTATED_EVENT,
      PROVIDER_ENABLED_EVENT,
      PROVIDER_DISABLED_EVENT,
      PROVIDER_CAP_CHANGED_EVENT,
      PROVIDER_UPDATED_EVENT,
      PROVIDER_DELETED_EVENT,
      PROVIDER_TESTED_EVENT,
      LEASE_GRANTED_EVENT,
    ];

    expect(named).toEqual([...AUDIT_ACTIONS]);
  });
});

describe("which name a settings change gets", () => {
  it("is the switch's own name when the switch is all that moved", () => {
    expect(providerUpdateEvent(["enabled"], true)).toBe(PROVIDER_ENABLED_EVENT);
    expect(providerUpdateEvent(["enabled"], false)).toBe(PROVIDER_DISABLED_EVENT);
  });

  it("is the cap's own name when the cap is all that moved", () => {
    expect(providerUpdateEvent(["monthlyCapCents"])).toBe(PROVIDER_CAP_CHANGED_EVENT);
  });

  it("is the general name for an edit AD.4 singles nothing out for", () => {
    // Renaming a connection and re-pointing its address are both events — *somebody changed
    // where this workspace's inference goes* is exactly what a trail is for — and inventing
    // `provider.renamed` here would be putting a name into AD.4's vocabulary from outside it.
    expect(providerUpdateEvent(["displayName"])).toBe(PROVIDER_UPDATED_EVENT);
    expect(providerUpdateEvent(["config"])).toBe(PROVIDER_UPDATED_EVENT);
    expect(providerUpdateEvent(["capabilityNote"])).toBe(PROVIDER_UPDATED_EVENT);
  });

  it("is the general name when the request did more than one thing", () => {
    // One act with two effects. `provider.enabled` on a request that also tripled the spend
    // ceiling would answer *what happened* with half of it.
    expect(providerUpdateEvent(["enabled", "monthlyCapCents"], true)).toBe(PROVIDER_UPDATED_EVENT);
  });

  it("is the general name for an edit that wrote nothing, which is a state no caller reaches", () => {
    // `PATCH {}` writes no event at all — the service returns before it records — so this is
    // a defensive answer rather than a path. It is asserted because the alternative to an
    // answer is a `switch` with a hole in it.
    expect(providerUpdateEvent([])).toBe(PROVIDER_UPDATED_EVENT);
  });

  it("calls a switch of unknown direction disabled rather than guessing enabled", () => {
    // Unreachable from the service, which only passes `enabled` when `enabled` is a field.
    // The answer still has to be one of the two, and *off* is the conservative reading of a
    // switch nobody can prove was turned on.
    expect(providerUpdateEvent(["enabled"])).toBe(PROVIDER_DISABLED_EVENT);
  });
});

describe("what reaches the detail column", () => {
  it("keeps every field that has a value", () => {
    expect(auditDetail({ kind: "anthropic", latency_ms: 38, ok: true, cap: null })).toEqual({
      kind: "anthropic",
      latency_ms: 38,
      ok: true,
      cap: null,
    });
  });

  it("drops the fields a builder left undefined", () => {
    // Builders compose their payloads with `undefined` where a field does not apply, so this
    // is what turns that into the object the column stores.
    expect(auditDetail({ kind: "anthropic", reason: undefined })).toEqual({ kind: "anthropic" });
  });

  it("keeps null, because null is an answer and undefined is the absence of one", () => {
    // `from_cap_cents: null` on a cap change means *there was no cap before*, which is the
    // most interesting cap change there is. Dropping it would make that indistinguishable
    // from a payload that forgot to say.
    expect(auditDetail({ from_cap_cents: null, to_cap_cents: 60000 })).toEqual({
      from_cap_cents: null,
      to_cap_cents: 60000,
    });
  });

  it("answers an event with nothing to say with an object rather than nothing", () => {
    // V022 defaults the column to `{}` for the same reason: a document a reader can
    // enumerate, rather than a null every reader has to test for first.
    expect(auditDetail()).toEqual({});
    expect(auditDetail({})).toEqual({});
  });

  it("is flat, which is what makes enumerating the keys the whole of reading it", () => {
    // The type refuses a nested value, and this is the runtime half of the same statement:
    // both secrecy greps scan the top level, so a nested object would be somewhere for a
    // credential to hide from them.
    for (const value of Object.values(auditDetail({ kind: "anthropic", latency_ms: 38 }))) {
      expect(typeof value).not.toBe("object");
    }
  });
});
