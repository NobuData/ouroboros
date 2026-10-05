import { describe, expect, it } from "vitest";

import {
  CLASS_MEANINGS,
  CLASS_VERBS,
  EDIT_AS_CODE,
  EDIT_AS_CODE_SOON,
  FOOTER_LINE,
  FORMER_MEMBER,
  NOTE_MAX_LENGTH,
  OWNER_GATE_TITLE,
  PUBLISH_CODES,
  type PolicyPreview,
  type PolicyVersionEntry,
  type RuleChange,
  SIDE_STATES,
  changeLine,
  confirmTitle,
  diffHeading,
  historyTrigger,
  loosenedRules,
  nextVersion,
  ownerGate,
  ownerNames,
  policyUnread,
  previousOf,
  publishLabel,
  publishedToast,
  publishedWhen,
  ruleLabel,
  sentenceList,
  switchLabel,
  versionByline,
  versionConflict,
  versionDiff,
  versionTag,
} from "@/app/policies/card-view";
import { CORE_RULES, type PolicyDocument, RULE_NAMES } from "@/app/policies/document";

/**
 * The Autonomy policies card's words and decisions (BS.4,
 * [#494](https://github.com/NobuData/ouroboros/issues/494)), as functions: the version tag, the
 * confirmation's per-rule lines, the owner gate's path, the refusals, the toast and the history's
 * before → after — each a unit test without rendering.
 */

/** Mockup 17's policy v7. */
const V7_DOCUMENT: PolicyDocument = {
  auto_merge: {
    enabled: true,
    conditions: { all: [{ effort_lte: "m" }, { not: { label: "refactor" } }] },
  },
  human_review: { enabled: true, conditions: { any: [{ label: "refactor" }, { effort_gte: "l" }] } },
  protected_paths: { enabled: true, conditions: { path_globs: ["boot/**", "keys/**", ".github/**"] } },
  spend_guard: { enabled: true, conditions: { per_run_cap_cents: 250, monthly_cap_cents: 60_000 } },
  dry_run_new_repos: { enabled: true, conditions: { first_n_loops: 10 } },
};

const ENABLED_AUTO_MERGE: RuleChange = {
  ruleId: "auto_merge",
  classification: "loosening",
  verb: "enabled",
  summary: "enabled auto-merge",
};

const TIGHTENED_SPEND: RuleChange = {
  ruleId: "spend_guard",
  classification: "tightening",
  verb: "changed",
  summary: "changed spend guard",
};

const DISABLED_REVIEW: RuleChange = {
  ruleId: "human_review",
  classification: "loosening",
  verb: "disabled",
  summary: "disabled human review",
};

/**
 * A preview of some changes, as the service would answer an admin.
 *
 * @param changes The changes.
 * @returns The preview.
 */
function preview(changes: readonly RuleChange[]): PolicyPreview {
  const loosens = changes.some((change) => change.classification === "loosening");

  return {
    baseVersion: 7,
    classification: loosens ? "loosening" : "tightening",
    changes,
    requiresOwner: loosens,
    mayPublish: !loosens,
  };
}

/**
 * A published version.
 *
 * @param overrides Fields to replace.
 * @returns The entry.
 */
function entry(overrides: Partial<PolicyVersionEntry> = {}): PolicyVersionEntry {
  return {
    version: 7,
    publishedAt: "2026-10-04T13:48:00.000Z",
    publishedBy: "user-ken",
    publisherName: "Ken",
    changeNote: "Enable auto-merge",
    classification: "loosening",
    changes: [ENABLED_AUTO_MERGE],
    summary: "enabled auto-merge (policy v7)",
    document: V7_DOCUMENT,
    ...overrides,
  };
}

describe("the card's copy", () => {
  it("keeps mockup 17's footer and link text verbatim", () => {
    expect(FOOTER_LINE).toBe("Policies are versioned — changes appear in the audit log.");
    expect(EDIT_AS_CODE).toBe("Edit as code");
  });

  it("points the soon-state at the issue that builds policy as code", () => {
    expect(EDIT_AS_CODE_SOON).toContain("#498");
    expect(EDIT_AS_CODE_SOON).toContain("BT.2");
  });

  it("says what is missing, then why, when the document could not be read", () => {
    expect(policyUnread("The service is unreachable.")).toBe(
      "The autonomy policies could not be read. The service is unreachable.",
    );
  });
});

describe("versionTag", () => {
  it("is mockup 17's `policy v7`", () => {
    expect(versionTag(7)).toBe("policy v7");
    expect(versionTag(1)).toBe("policy v1");
  });

  it("says nothing is published rather than inventing a version", () => {
    expect(versionTag(null)).toBe("not published");
  });
});

describe("ruleLabel and switchLabel", () => {
  it("names every core rule as the card does", () => {
    for (const id of CORE_RULES) {
      expect(ruleLabel(id)).toBe(RULE_NAMES[id]);
    }
  });

  it("names a custom rule by its id, which is the only name it has", () => {
    expect(ruleLabel("custom:night-freeze")).toBe("custom:night-freeze");
  });

  it("does not read a prototype key as a core rule", () => {
    expect(ruleLabel("toString")).toBe("toString");
  });

  it("names a switch by what pressing it would do", () => {
    expect(switchLabel("spend_guard", true)).toBe("Turn off Spend guard");
    expect(switchLabel("spend_guard", false)).toBe("Turn on Spend guard");
    expect(switchLabel("custom:night-freeze", false)).toBe("Turn on custom:night-freeze");
  });
});

describe("the confirmation", () => {
  it("has a verb and a meaning for every class", () => {
    expect(CLASS_VERBS).toEqual({ tightening: "Tightens", loosening: "Loosens", neutral: "Changes" });

    for (const meaning of Object.values(CLASS_MEANINGS)) {
      expect(meaning.length).toBeGreaterThan(0);
    }
    expect(CLASS_MEANINGS.loosening).toMatch(/^Loosening:/);
    expect(CLASS_MEANINGS.tightening).toMatch(/^Tightening:/);
  });

  it("takes a note as long as the service does", () => {
    expect(NOTE_MAX_LENGTH).toBe(500);
  });

  it("counts the next version from the one in force, and from nothing", () => {
    expect(nextVersion(7)).toBe(8);
    expect(nextVersion(null)).toBe(1);
  });

  it("names the version a publish would create, in the title and on the button", () => {
    expect(confirmTitle(7)).toBe("Publish policy v8?");
    expect(publishLabel(7)).toBe("Publish policy v8");
    expect(confirmTitle(null)).toBe("Publish policy v1?");
    expect(publishLabel(null)).toBe("Publish policy v1");
  });

  it("says which way each changed rule moves, by name, with the service's own summary", () => {
    expect(changeLine(ENABLED_AUTO_MERGE)).toBe(
      "Loosens Auto-merge when all gates green — enabled auto-merge",
    );
    expect(changeLine(TIGHTENED_SPEND)).toBe("Tightens Spend guard — changed spend guard");
    expect(
      changeLine({
        ruleId: "custom:night-freeze",
        classification: "neutral",
        verb: "removed",
        summary: "removed custom:night-freeze",
      }),
    ).toBe("Changes custom:night-freeze — removed custom:night-freeze");
  });
});

describe("sentenceList", () => {
  it("joins names the way a sentence does", () => {
    expect(sentenceList([])).toBe("");
    expect(sentenceList(["a"])).toBe("a");
    expect(sentenceList(["a", "b"])).toBe("a and b");
    expect(sentenceList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("the owner gate", () => {
  it("lists only the rules a preview loosens, in its order", () => {
    expect(loosenedRules(preview([TIGHTENED_SPEND, DISABLED_REVIEW, ENABLED_AUTO_MERGE]))).toEqual([
      "Human review required",
      "Auto-merge when all gates green",
    ]);
    expect(loosenedRules(preview([TIGHTENED_SPEND]))).toEqual([]);
  });

  it("says which rule loosens and that an owner must publish", () => {
    const gate = ownerGate(preview([DISABLED_REVIEW]), ["Ken Suenobu"]);

    expect(gate.head).toBe("This loosens Human review required — an owner must publish.");
    expect(gate.why).toMatch(/owner/);
    expect(OWNER_GATE_TITLE).toMatch(/owner/);
  });

  it("names every loosened rule when there is more than one", () => {
    const gate = ownerGate(preview([DISABLED_REVIEW, ENABLED_AUTO_MERGE, TIGHTENED_SPEND]), []);

    expect(gate.head).toBe(
      "This loosens Human review required and Auto-merge when all gates green — an owner must publish.",
    );
  });

  it("names the one owner to ask", () => {
    expect(ownerGate(preview([DISABLED_REVIEW]), ["Ken Suenobu"]).ask).toBe(
      "Ask Ken Suenobu to make this change — they are the owner of this workspace.",
    );
  });

  it("names every owner when there are several", () => {
    expect(ownerGate(preview([DISABLED_REVIEW]), ["Ken", "Maya", "Priya"]).ask).toBe(
      "Ask Ken, Maya and Priya to make this change — they are the owners of this workspace.",
    );
  });

  it("still gives a path when the owners could not be read", () => {
    expect(ownerGate(preview([DISABLED_REVIEW]), []).ask).toBe(
      "Ask a workspace owner to make this change.",
    );
  });

  it("says what the admin can still do alone, and that nothing was lost", () => {
    const { alone } = ownerGate(preview([DISABLED_REVIEW]), []);

    expect(alone).toMatch(/unsaved/);
    expect(alone).toMatch(/publish the rest yourself/);
  });
});

describe("a publish that did not land", () => {
  it("knows the service's refusal codes", () => {
    expect(PUBLISH_CODES).toEqual({
      conflict: "policy_version_conflict",
      unchanged: "policy_unchanged",
      ownerRequired: "policy_loosening_requires_owner",
      invalid: "policy_document_invalid",
    });
  });

  it("says which version won the race, what to do, and that nothing was published", () => {
    expect(versionConflict(8)).toBe(
      "Policy v8 was published while you were editing. Reload the page to edit from it; nothing of yours was published.",
    );
  });

  it("says the same without a number when the service gave none", () => {
    expect(versionConflict(null)).toBe(
      "A newer policy version was published while you were editing. Reload the page to edit from it; nothing of yours was published.",
    );
  });
});

describe("publishedToast", () => {
  it("names the version, carries the audit line and links to the audit section", () => {
    expect(publishedToast(8, "enabled auto-merge (policy v8)")).toEqual({
      text: "Policy v8 published.",
      line: "enabled auto-merge (policy v8)",
      href: "/settings#audit",
      link: "See it in the audit log",
    });
  });
});

describe("the history's words", () => {
  it("names the tag's button by what it opens", () => {
    expect(historyTrigger(7)).toBe("policy v7 — open the policy history");
  });

  it("writes an instant the same on every machine", () => {
    expect(publishedWhen("2026-10-04T13:48:00.000Z")).toBe("2026-10-04 13:48 UTC");
    // An offset is converted, not shown as typed.
    expect(publishedWhen("2026-10-04T23:30:00-06:00")).toBe("2026-10-05 05:30 UTC");
  });

  it("hands back what it was given when that is not an instant", () => {
    expect(publishedWhen("yesterday")).toBe("yesterday");
  });

  it("bylines a version with its publisher and when", () => {
    expect(versionByline(entry())).toBe("Ken · 2026-10-04 13:48 UTC");
  });

  it("bylines a version whose publisher was removed as a former member's", () => {
    expect(versionByline(entry({ publisherName: null, publishedBy: null }))).toBe(
      `${FORMER_MEMBER} · 2026-10-04 13:48 UTC`,
    );
  });

  it("heads a diff with the two versions it compares", () => {
    expect(diffHeading(7)).toBe("v6 → v7");
    expect(diffHeading(2)).toBe("v1 → v2");
  });

  it("heads the first version's diff as the first version", () => {
    expect(diffHeading(1)).toBe("v1 — the first version");
  });

  it("has words for every state a side can be in", () => {
    expect(SIDE_STATES).toEqual({ on: "on", off: "off", absent: "not in the policy" });
  });
});

describe("previousOf", () => {
  const items = [entry({ version: 7 }), entry({ version: 6 }), entry({ version: 4 })];

  it("finds the version before one among those loaded", () => {
    expect(previousOf(items, 7)?.version).toBe(6);
  });

  it("answers null when the predecessor is not loaded", () => {
    expect(previousOf(items, 6)).toBeNull();
    expect(previousOf(items, 4)).toBeNull();
  });

  it("answers null for the first version", () => {
    expect(previousOf([entry({ version: 1 })], 1)).toBeNull();
  });
});

describe("versionDiff", () => {
  const v6 = entry({
    version: 6,
    document: { ...V7_DOCUMENT, auto_merge: { ...V7_DOCUMENT.auto_merge, enabled: false } },
  });

  it("draws the seeded v6 → v7: auto-merge off → on, with the same chips on both sides", () => {
    expect(versionDiff(entry(), v6)).toEqual([
      {
        ruleId: "auto_merge",
        name: "Auto-merge when all gates green",
        classification: "loosening",
        summary: "enabled auto-merge",
        before: { state: "off", chips: ["effort ≤ M", "non-refactor"] },
        after: { state: "on", chips: ["effort ≤ M", "non-refactor"] },
      },
    ]);
  });

  it("draws changed terms on each side from that side's document", () => {
    const before = entry({
      version: 6,
      document: {
        ...V7_DOCUMENT,
        spend_guard: { enabled: true, conditions: { per_run_cap_cents: 500 } },
      },
    });
    const [row] = versionDiff(entry({ changes: [TIGHTENED_SPEND] }), before);

    expect(row.before).toEqual({ state: "on", chips: ["pause loop at $5/run"] });
    expect(row.after).toEqual({
      state: "on",
      chips: ["pause loop at $2.50/run", "monthly cap $600/provider"],
    });
  });

  it("leaves the before side unknown when the version before is not loaded", () => {
    const [row] = versionDiff(entry(), null);

    expect(row.before).toBeNull();
    expect(row.after.state).toBe("on");
  });

  it("compares the first version with no policy: every rule was absent before it", () => {
    const [row] = versionDiff(entry({ version: 1 }), null);

    expect(row.before).toEqual({ state: "absent", chips: [] });
    expect(row.after).toEqual({ state: "on", chips: ["effort ≤ M", "non-refactor"] });
  });

  it("draws a removed rule as absent afterwards, with what it held before", () => {
    const removed: RuleChange = {
      ruleId: "custom:night-freeze",
      classification: "neutral",
      verb: "removed",
      summary: "removed custom:night-freeze",
    };
    const before = entry({
      version: 6,
      document: {
        ...V7_DOCUMENT,
        "custom:night-freeze": { enabled: true, conditions: { path_globs: ["drivers/**"] } },
      },
    });
    const [row] = versionDiff(entry({ changes: [removed] }), before);

    expect(row.name).toBe("custom:night-freeze");
    expect(row.before).toEqual({ state: "on", chips: ["drivers/"] });
    expect(row.after).toEqual({ state: "absent", chips: [] });
  });

  it("keeps the service's order, and is empty for a version that changed no rule", () => {
    const rows = versionDiff(entry({ changes: [TIGHTENED_SPEND, ENABLED_AUTO_MERGE] }), v6);

    expect(rows.map((row) => row.ruleId)).toEqual(["spend_guard", "auto_merge"]);
    expect(versionDiff(entry({ changes: [] }), v6)).toEqual([]);
  });
});

describe("ownerNames", () => {
  it("lists the members who hold the owner role, in the list's order", () => {
    expect(
      ownerNames([
        { name: "Maya Chen", roles: ["admin"] },
        { name: "Ken Suenobu", roles: ["owner"] },
        { name: "Priya", roles: ["member", "owner"] },
        { name: "Sam", roles: ["viewer"] },
      ]),
    ).toEqual(["Ken Suenobu", "Priya"]);
  });

  it("is empty when nobody in the list is an owner", () => {
    expect(ownerNames([{ name: "Maya Chen", roles: ["admin"] }])).toEqual([]);
    expect(ownerNames([])).toEqual([]);
  });
});
