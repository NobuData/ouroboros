import { AUDIT_ACTIONS } from "../audit/audit.events";
import { MOCKUP_ROWS, planeRow } from "./audit-plane.fixture";
import { auditTodayRow, clockIn } from "./audit-plane.resources";
import {
  ERASED_ACTOR_LABEL,
  SYSTEM_ACTOR_LABEL,
  actorLabel,
  eventSentence,
} from "./audit-plane.sentences";

/**
 * The audit card's lines (#486): `time · actor · event`, composed from typed facts — never from a
 * string an emitter wrote.
 */
describe("composing the audit card's lines", () => {
  it("reproduces mockup 17's five rows exactly", () => {
    const clock = clockIn("UTC");

    expect(
      MOCKUP_ROWS.map((row) => {
        const line = auditTodayRow(row, clock);
        return `${line.time}  ${line.actor}  ${line.event}`;
      }),
    ).toEqual([
      "14:31  ouroboros-app[bot]  pushed PR #514 rev 2",
      "14:12  Ken  rotated Anthropic API key",
      "13:48  Ken  enabled auto-merge (policy v7)",
      "13:22  Maya  approved waiver on PR #509",
      "12:04  system  runner forge-03 marked offline",
    ]);
  });

  it("carries the actor kind so the card can style bots and the system", () => {
    expect(MOCKUP_ROWS.map((row) => auditTodayRow(row, clockIn("UTC")).actorKind)).toEqual([
      "bot",
      "human",
      "human",
      "human",
      "system",
    ]);
  });

  it("gives every action this service writes a non-empty sentence", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(eventSentence({ action, detail: {} }).length).toBeGreaterThan(0);
    }
  });

  it("reads an action no template knows from its own name — SQL trigger writers included", () => {
    expect(eventSentence({ action: "pr_merge_plan.armed", detail: {} })).toBe(
      "pr merge plan armed",
    );
    expect(eventSentence({ action: "run_control.requested", detail: {} })).toBe(
      "run control requested",
    );
  });

  it("degrades to a shorter sentence when a fact is missing or mistyped — never `undefined`", () => {
    expect(eventSentence({ action: "pr_revision.pushed", detail: {} })).toBe(
      "pushed a PR revision",
    );
    expect(eventSentence({ action: "pr_revision.pushed", detail: { pr_number: "514" } })).toBe(
      "pushed a PR revision",
    );
    expect(eventSentence({ action: "provider.rotated", detail: {} })).toBe(
      "rotated provider API key",
    );
    expect(eventSentence({ action: "policy.published", detail: {} })).toBe("published the policy");
    expect(eventSentence({ action: "runner.marked_offline", detail: { runner: 3 } })).toBe(
      "runner marked offline",
    );
  });

  it("composes a multi-rule publish from the typed changes fact", () => {
    expect(
      eventSentence({
        action: "policy.published",
        detail: { version: 9, changes: "human_review:disabled,custom:freeze:removed" },
      }),
    ).toBe("disabled human review, removed custom:freeze (policy v9)");
  });

  it("ignores a stored summary string — the line is composed, not copied", () => {
    expect(
      eventSentence({
        action: "policy.published",
        detail: { version: 8, changes: "auto_merge:disabled", summary: "something else entirely" },
      }),
    ).toBe("disabled auto-merge (policy v8)");
  });

  it("says a refused operation failed", () => {
    expect(
      eventSentence({
        action: "provider.rotated",
        detail: { kind: "openai_compatible", outcome: "failure" },
      }),
    ).toBe("rotated OpenAI-compatible API key (failed)");
  });

  it("names a waiver by its cases when it names no PR", () => {
    expect(eventSentence({ action: "triage.waived", detail: { cases: 3 } })).toBe(
      "approved waiver on 3 cases",
    );
    expect(eventSentence({ action: "triage.waived", detail: { cases: 1 } })).toBe(
      "approved waiver on 1 case",
    );
  });

  it("composes the plane's own events", () => {
    expect(eventSentence({ action: "audit.exported", detail: { rows: 120 } })).toBe(
      "exported 120 audit rows",
    );
    expect(eventSentence({ action: "audit.purged", detail: { removed: 1, days: 400 } })).toBe(
      "purged 1 audit row older than 400d",
    );
  });
});

describe("the actor column", () => {
  it("prints a person by first name, the bot as [bot], a service account as service:<name>", () => {
    expect(actorLabel(planeRow({ actor_kind: "human", actor_name: "Ken Suenobu" }))).toBe("Ken");
    expect(actorLabel(planeRow({ actor_kind: "bot", actor_service: "ouroboros-app" }))).toBe(
      "ouroboros-app[bot]",
    );
    expect(actorLabel(planeRow({ actor_kind: "service", actor_service: "devops-bot" }))).toBe(
      "service:devops-bot",
    );
    expect(actorLabel(planeRow({ actor_kind: "system" }))).toBe(SYSTEM_ACTOR_LABEL);
  });

  it("keeps an erased person's event a person's, without a name", () => {
    expect(actorLabel(planeRow({ actor_kind: "human", actor_id: null, actor_name: null }))).toBe(
      ERASED_ACTOR_LABEL,
    );
    expect(actorLabel(planeRow({ actor_kind: "human", actor_name: "   " }))).toBe(
      ERASED_ACTOR_LABEL,
    );
  });
});

describe("the card's clock", () => {
  it("prints HH:MM, 24-hour, in the requested zone", () => {
    const at = new Date("2026-10-05T14:31:59.000Z");

    expect(clockIn("UTC")(at)).toBe("14:31");
    expect(clockIn("America/New_York")(at)).toBe("10:31");
    expect(clockIn("Asia/Tokyo")(new Date("2026-10-05T15:05:00.000Z"))).toBe("00:05");
  });
});
