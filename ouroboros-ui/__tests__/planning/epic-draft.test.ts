import { describe, expect, it } from "vitest";

import {
  LINKS_UNCHANGED,
  NEEDS_MONTHS,
  NEEDS_NAME,
  NOTHING_ADDED,
  NOTHING_CHANGED,
  NOTHING_SAVED,
  STATUS_OPTIONS,
  TICKETS_HEADING,
  TINT_OPTIONS,
  createLaneBody,
  editorFailure,
  epicDraftProblems,
  linkCandidates,
  linkLabel,
  mirrorLine,
  openingEpicDraft,
  patchBody,
  saveReason,
  ticketsHeading,
  unlinkLabel,
} from "@/app/planning/epic-draft";
import { READ_ONLY_STEP_REASON } from "@/app/planning/gantt";
import { RANGE_BACKWARDS } from "@/app/planning/create";

import { epicLinks, planningEpic, planningTicket } from "../helpers/planning";

/**
 * The epic editor's decisions (#286): the form a lane opens on, the patch of only what changed, the body
 * **Add epic** sends, why Save is inert, and what a refusal says.
 */

describe("the form", () => {
  it("opens on the lane's own values, months as typed", () => {
    expect(openingEpicDraft(planningEpic())).toEqual({
      name: "OTA hardening",
      tint: "accent",
      status: "active",
      startMonth: "2026-07",
      endMonth: "2026-09",
    });
    expect(openingEpicDraft(planningEpic({ startMonth: null, endMonth: null }))).toMatchObject({
      startMonth: "",
      endMonth: "",
    });
  });

  it("opens Add epic active and neutral, the service's own defaults", () => {
    expect(openingEpicDraft(null)).toEqual({ name: "", tint: "neutral", status: "active", startMonth: "", endMonth: "" });
  });

  it("offers every tint and status the contract names", () => {
    expect(TINT_OPTIONS.map((option) => option.value)).toEqual(["accent", "model", "warn", "ok", "neutral"]);
    expect(STATUS_OPTIONS.map((option) => option.value)).toEqual(["active", "proposed", "done", "unscoped"]);
  });
});

describe("patchBody — only what changed", () => {
  const epic = planningEpic();

  it("sends nothing for an untouched form", () => {
    expect(patchBody(epic, openingEpicDraft(epic))).toEqual({});
  });

  it("sends a trimmed name, a tint and a status that changed", () => {
    expect(patchBody(epic, { ...openingEpicDraft(epic), name: " OTA v2 ", tint: "ok", status: "proposed" })).toEqual({
      name: "OTA v2",
      tint: "ok",
      status: "proposed",
    });
  });

  it("sends the months as a pair when either moved, and null for none", () => {
    expect(patchBody(epic, { ...openingEpicDraft(epic), endMonth: "2026-10" })).toEqual({
      startMonth: "2026-07",
      endMonth: "2026-10",
    });
    expect(patchBody(epic, { ...openingEpicDraft(epic), startMonth: "", endMonth: "" })).toEqual({
      startMonth: null,
      endMonth: null,
    });
  });
});

describe("createLaneBody", () => {
  it("files the lane under the roadmap's head, with its months or none", () => {
    const draft = { name: " Secure boot ", tint: "warn" as const, status: "active" as const, startMonth: "", endMonth: "" };

    expect(createLaneBody(draft, { name: "Helios 2.1", window: "Q3–Q4 2026" })).toEqual({
      name: "Secure boot",
      tint: "warn",
      status: "active",
      startMonth: null,
      endMonth: null,
      roadmapName: "Helios 2.1",
      roadmapWindow: "Q3–Q4 2026",
    });
    expect(
      createLaneBody({ ...draft, startMonth: "2026-11", endMonth: "2026-12" }, { name: null, window: null }),
    ).toMatchObject({ startMonth: "2026-11", endMonth: "2026-12", roadmapName: null, roadmapWindow: null });
  });
});

describe("saveReason", () => {
  const epic = planningEpic();

  it("is ready for a changed, valid form", () => {
    const draft = { ...openingEpicDraft(epic), name: "OTA v2" };

    expect(saveReason(epicDraftProblems(draft), patchBody(epic, draft), true)).toBeUndefined();
    expect(saveReason(epicDraftProblems({ ...openingEpicDraft(null), name: "New" }), null, true)).toBeUndefined();
  });

  it("names what is missing, top first", () => {
    const blank = { ...openingEpicDraft(epic), name: "  " };
    const half = { ...openingEpicDraft(epic), endMonth: "" };
    const backwards = { ...openingEpicDraft(epic), endMonth: "2026-06" };

    expect(saveReason(epicDraftProblems(blank), patchBody(epic, blank), true)).toBe(NEEDS_NAME);
    expect(saveReason(epicDraftProblems(half), patchBody(epic, half), true)).toBe(NEEDS_MONTHS);
    expect(saveReason(epicDraftProblems(backwards), patchBody(epic, backwards), true)).toBe(NEEDS_MONTHS);
  });

  it("is inert for an untouched form, and for a reader", () => {
    const draft = openingEpicDraft(epic);

    expect(saveReason(epicDraftProblems(draft), patchBody(epic, draft), true)).toBe(NOTHING_CHANGED);
    expect(saveReason(epicDraftProblems(draft), {}, false)).toBe(READ_ONLY_STEP_REASON);
  });
});

describe("editorFailure", () => {
  const refusal = (code: string) => ({ code, message: "The service's sentence.", details: {} });

  it("says what each refusal means, ending on what did not happen", () => {
    expect(editorFailure(refusal("forbidden"), NOTHING_SAVED).message).toBe(`${READ_ONLY_STEP_REASON} ${NOTHING_SAVED}`);
    expect(editorFailure(refusal("epic_month_range_invalid"), NOTHING_SAVED)).toEqual({
      message: `The months are not a forwards pair. ${NOTHING_SAVED}`,
      range: RANGE_BACKWARDS,
    });
    expect(editorFailure(refusal("validation_failed"), NOTHING_ADDED).message).toMatch(/No epic was added\.$/);
    expect(editorFailure(refusal("planning_epic_not_found"), NOTHING_SAVED).message).toMatch(/no longer exists/);
    expect(editorFailure(refusal("planning_tickets_not_found"), LINKS_UNCHANGED).message).toMatch(/no longer in this workspace/);
    expect(editorFailure(refusal("internal_error"), NOTHING_SAVED).message).toBe(`${NOTHING_SAVED} The service's sentence.`);
  });
});

describe("tickets and mirrors", () => {
  it("offers only tickets the lane does not already link", () => {
    const linked = epicLinks().tickets;
    const other = planningTicket({ id: "other", externalKey: "#600" });

    expect(linkCandidates([linked[0]!, other], linked)).toEqual([other]);
  });

  it("heads the list with the count the chip is computed from", () => {
    expect(ticketsHeading(epicLinks().tickets)).toBe(`${TICKETS_HEADING} · 2 · 1 done`);
    expect(ticketsHeading([])).toBe(`${TICKETS_HEADING} · 0 · 0 done`);
  });

  it("names each mirror and each action by what it is about", () => {
    expect(mirrorLine(epicLinks().mirrors[0]!)).toBe("GitHub · acme-robotics — parent issue #612");
    expect(mirrorLine({ sourceId: "s", sourceName: "Jira · HEL", kind: "jira_epic", externalRef: "HEL-9" })).toBe(
      "Jira · HEL — Jira epic HEL-9",
    );
    expect(unlinkLabel(planningTicket())).toBe("Unlink #548");
    expect(linkLabel(planningTicket())).toBe("Link #548");
  });
});
