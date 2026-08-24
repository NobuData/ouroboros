import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AuditAction } from "@/app/api/audit";
import {
  ADD_PROVIDER_LABEL,
  ADD_PROVIDER_REASON,
  NOBODY,
  PROVIDERS_NEXT_NOTE,
  PROVIDERS_SUBLINE_TEMPLATE,
  PROVIDERS_TITLE,
  SENTENCES,
  WORKSPACE_SLOT,
  actorOf,
  kindOf,
  outcomeOf,
  providersSubline,
  reasonOf,
  stampOf,
} from "@/app/providers/view";

import { auditEvent, seededTrail } from "../helpers/audit";
import { membership } from "../helpers/login";

/**
 * The credential trail's decisions (#225).
 *
 * The sheet's whole value is that it is trustworthy, so this suite is organised around the
 * four ways a trail lies — it invents an actor, it renders an action it does not recognise,
 * it states a refusal as an act, or it prints a time in a zone nobody named.
 * `audit-trail.test.tsx` proves what reaches the DOM; this proves the judgements behind it.
 *
 * The foot of the file is the page's copy (#227), and the one case there that matters is the
 * subline: it is held to `docs/SECURITY_MODEL.md` § 7.2 **by reading the document**, because
 * *verbatim* is a claim about two texts and a test that only looked at one of them would be
 * asserting that a constant equals itself.
 */

describe("what an action reads as", () => {
  it("has a sentence for every action the contract publishes", () => {
    // The map is `Record<AuditAction, string>`, so this is already a compile-time guarantee.
    // Asserting it at run time as well is what catches the other direction: a key added here
    // that the union does not have would type-check as an excess property in some positions
    // and would be a row nothing can ever render.
    const actions: readonly AuditAction[] = [
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
    ];

    expect(Object.keys(SENTENCES).sort()).toEqual([...actions].sort());
  });

  it("completes the actor rather than restating them", () => {
    // Every row reads *time · actor · sentence*, so a sentence beginning with a name would
    // print it twice.
    for (const sentence of Object.values(SENTENCES)) {
      expect(sentence[0]).toBe(sentence[0].toLowerCase());
    }
  });

  it("distinguishes the switch's two directions and the cap from the general edit", () => {
    // AD.4 singles these three out because they are the affordances mockup 07 draws, and a
    // trail saying *edited the settings* where somebody saw themselves press a switch would
    // be describing the request instead of the act.
    expect(SENTENCES["provider.enabled"]).not.toBe(SENTENCES["provider.disabled"]);
    expect(SENTENCES["provider.cap_changed"]).not.toBe(SENTENCES["provider.updated"]);
  });
});

describe("who did it", () => {
  it("is the person's name when there is one", () => {
    expect(actorOf(auditEvent())).toBe("Ken Suenobu");
  });

  it("is a dash when nobody did", () => {
    // A lease grant: a worker authenticates with a service key and is not somebody.
    expect(actorOf(auditEvent({ actorId: null, actorName: null }))).toBe(NOBODY);
  });

  it("is a dash when the person has been deleted, and never their surviving id", () => {
    // V022's `on delete set null` leaves the id null too, but a future writer might not — and
    // an id in this column would be a name-shaped string that is not a name. A reader can act
    // on *nobody*; they cannot act on a uuid.
    expect(actorOf(auditEvent({ actorName: null }))).toBe(NOBODY);
    expect(actorOf(auditEvent({ actorName: null }))).not.toContain("5eed");
  });
});

describe("whether it succeeded", () => {
  it("reads a refusal as one", () => {
    expect(outcomeOf(auditEvent({ detail: { outcome: "failure" } }))).toBe("failure");
  });

  it("reads a completion as one", () => {
    expect(outcomeOf(auditEvent())).toBe("success");
  });

  it("treats an unlabelled event as a completion", () => {
    // Unreachable today — every event this service writes carries the field — and the default
    // is the safe direction: an event from a future writer that omitted it is far more likely
    // to be a completion than a refusal nobody labelled.
    expect(outcomeOf(auditEvent({ detail: { kind: "anthropic" } }))).toBe("success");
  });

  it("carries the refusal's code and nothing else", () => {
    const refused = auditEvent({
      detail: { outcome: "failure", reason: "provider_validation_failed" },
    });

    expect(reasonOf(refused)).toBe("provider_validation_failed");
  });

  it("has no reason for a completion", () => {
    expect(reasonOf(auditEvent())).toBeNull();
  });

  it("has no reason for a refusal that named none", () => {
    expect(reasonOf(auditEvent({ detail: { outcome: "failure" } }))).toBeNull();
  });
});

describe("which provider it was about", () => {
  it("is the kind the payload names", () => {
    expect(kindOf(auditEvent())).toBe("anthropic");
  });

  it("is absent when the payload names none, rather than invented", () => {
    // A refusal that happened before the row was read genuinely does not know — a reveal is
    // rate-limited before anything is fetched, on purpose.
    expect(kindOf(auditEvent({ detail: { outcome: "failure" } }))).toBeNull();
  });

  it("is absent for a payload whose kind is not a string", () => {
    // `detail` is a flat object of scalars, so a number here is not something the service
    // writes — and rendering `38` in the provider column would be worse than an empty cell.
    expect(kindOf(auditEvent({ detail: { kind: 38 } }))).toBeNull();
  });
});

describe("when it happened", () => {
  it("prints the instant the mockup's own example row prints", () => {
    // `2026-08-08 14:02 · Ken · rotated Anthropic key`.
    expect(stampOf("2026-08-08T14:02:11.000Z")).toBe("2026-08-08 14:02");
  });

  it("is UTC rather than the reader's own zone", () => {
    // The surface two people open during an incident, one of them from another continent.
    // *The reveal at 14:02* has to mean the same thing to both — and a formatter that read
    // the runner's zone would make this suite pass in one place and fail in another.
    expect(stampOf("2026-01-01T23:30:00.000Z")).toBe("2026-01-01 23:30");
    expect(stampOf("2026-07-01T00:05:00.000Z")).toBe("2026-07-01 00:05");
  });

  it("pads every field, so a column of stamps is a column", () => {
    // The stamp column is *scanned*. A row reading `2026-1-1 0:05` would start in a different
    // place from the one above it.
    expect(stampOf("2026-01-02T03:04:00.000Z")).toBe("2026-01-02 03:04");
  });

  it("answers an unparseable instant with itself", () => {
    // Whatever the service sent is more useful to whoever has to diagnose it than two words
    // saying only that this function was surprised.
    expect(stampOf("not a date")).toBe("not a date");
  });

  it("renders every stamp in the seeded history", () => {
    for (const event of seededTrail()) {
      expect(stampOf(event.occurredAt)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    }
  });
});

/* ---------------------------------------------------------------------- the page's copy */

/** The security model, read from the repository — the source the subline is a copy of. */
const SECURITY_MODEL = readFileSync(
  join(import.meta.dirname, "..", "..", "..", "docs", "SECURITY_MODEL.md"),
  "utf8",
);

/**
 * The approved subline as § 7.2 writes it: the fenced block under that heading, with its
 * line breaks joined — the document says of its own blocks that *the line breaks in them
 * are not part of the string*.
 *
 * @returns The one sentence pair the page may render, or `""` if the section has moved.
 */
function approvedSubline(): string {
  const section = SECURITY_MODEL.split("### 7.2 The page-head subline")[1] ?? "";
  const block = /```text\n([\s\S]*?)```/.exec(section)?.[1] ?? "";

  return block.replace(/\s*\n\s*/g, " ").trim();
}

describe("the subline", () => {
  it("is docs/SECURITY_MODEL.md § 7.2, verbatim", () => {
    // The ticket's second acceptance criterion, as a comparison of two texts rather than a
    // claim about one. A change to either that is not a change to both fails here — which is
    // the document's own rule: a change to that section is a change to the product's claims.
    expect(approvedSubline()).not.toBe("");
    expect(PROVIDERS_SUBLINE_TEMPLATE).toBe(approvedSubline());
  });

  it("carries the document's slot for the workspace, exactly once", () => {
    expect(PROVIDERS_SUBLINE_TEMPLATE.split(WORKSPACE_SLOT)).toHaveLength(2);
  });

  it("says workspace, never the mockup's tenant", () => {
    // § 7.2's second deliberate departure: `tenant` is an internal term and appears in no
    // other user-facing string.
    expect(PROVIDERS_SUBLINE_TEMPLATE).not.toMatch(/tenant/i);
  });

  it("makes no claim about tokens, because the system makes none", () => {
    // The mockup's *"workers only ever see short-lived tokens"* is what AD.5 corrected: AD.3
    // proxies invocation, and workers never receive a key at all (§ 4.1).
    expect(PROVIDERS_SUBLINE_TEMPLATE).not.toMatch(/15-minute|short-lived|token/i);
    expect(PROVIDERS_SUBLINE_TEMPLATE).toMatch(/workers never receive them at all/);
  });

  it("puts the workspace's display name in the slot and changes nothing else", () => {
    const name = membership().name;

    expect(providersSubline(name)).toBe(PROVIDERS_SUBLINE_TEMPLATE.replace(WORKSPACE_SLOT, name));
    expect(providersSubline(name)).toContain(`${name}'s encrypted vault`);
    expect(providersSubline(name)).not.toContain(WORKSPACE_SLOT);
  });

  it("applies the template's possessive as written, with no rule of its own", () => {
    // The copy is not the UI's to adjust, and an apostrophe rule for names ending in *s*
    // would be an adjustment. If the document wants one it belongs in § 7.2.
    expect(providersSubline("Acme Robotics")).toContain("Acme Robotics's encrypted vault");
  });

  it("substitutes the name literally, even one shaped like a replacement pattern", () => {
    // A name is data. `String.replace` reads `$&` and `$'` in a replacement *string* as
    // pattern syntax, and a workspace called `A$&B` would otherwise read its own placeholder
    // back into the sentence.
    expect(providersSubline("A$&B")).toContain("A$&B's encrypted vault");
    expect(providersSubline("A$'B")).toContain("A$'B's encrypted vault");
    expect(providersSubline("A$$B")).toContain("A$$B's encrypted vault");
  });
});

describe("the rest of the head", () => {
  it("titles the page as the mockup and the tab both name it", () => {
    expect(PROVIDERS_TITLE).toBe("Providers & keys");
  });

  it("labels the primary action as the mockup does", () => {
    expect(ADD_PROVIDER_LABEL).toBe("+ Add provider");
  });

  it("explains + Add provider by naming the issue that builds the catalog", () => {
    // The sidebar's treatment for an unbuilt surface: a usable answer to "when?" rather than
    // the word *soon* on its own. AE.5 (#231) is the flow.
    expect(ADD_PROVIDER_REASON).toMatch(/#231/);
  });

  it("names the issues that fill the space below the tab set, and says what is live", () => {
    for (const issue of ["#228", "#229", "#230", "#231", "#232"]) {
      expect(PROVIDERS_NEXT_NOTE).toContain(issue);
    }

    expect(PROVIDERS_NEXT_NOTE).toMatch(/Audit log .* live/);
  });
});
