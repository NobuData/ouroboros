import { describe, expect, it } from "vitest";

import type { AuditAction } from "@/app/api/audit";
import {
  NOBODY,
  SENTENCES,
  actorOf,
  kindOf,
  outcomeOf,
  reasonOf,
  stampOf,
} from "@/app/providers/view";

import { auditEvent, seededTrail } from "../helpers/audit";

/**
 * The credential trail's decisions (#225).
 *
 * The sheet's whole value is that it is trustworthy, so this suite is organised around the
 * four ways a trail lies — it invents an actor, it renders an action it does not recognise,
 * it states a refusal as an act, or it prints a time in a zone nobody named.
 * `audit-trail.test.tsx` proves what reaches the DOM; this proves the judgements behind it.
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
