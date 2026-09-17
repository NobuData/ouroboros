import { describe, expect, it } from "vitest";

import {
  CATALOG_UNREAD_REASON,
  DRAFT_ROLE_REASON,
  DRAFTING,
  LOCAL_KEY_PREFIX,
  NO_PROMPT_REASON,
  NO_TRACKER_REASON,
  NOTHING_SELECTED_FOOTER,
  NOTHING_SELECTED_REASON,
  PUSHED_EDIT_REASON,
  PUSH_ROLE_REASON,
  PUSH_RUNNING_REASON,
  BATCH_CLOSED_REASON,
  type GeneratorForm,
  type TrackerOption,
  allPushedReason,
  allSized,
  batchHref,
  blocksNote,
  draftHeading,
  draftReason,
  editBody,
  editReason,
  estimatorTag,
  footerText,
  formatDays,
  generateBody,
  initialTracker,
  isSelected,
  milestoneValue,
  notConnectedReason,
  parseBatchParam,
  pushLabel,
  pushMode,
  pushOutcome,
  pushReason,
  regenerateReason,
  rowPush,
  rowSizing,
  selectReason,
  selectedCount,
  sizingProgress,
  trackerOptions,
  unsupportedReason,
} from "@/app/planning/generator";

import {
  SEEDED_BATCH_ID,
  planningBatch,
  planningDraft,
  pushResult,
  seededDrafts,
  writableCatalog,
} from "../helpers/planning";
import { SEEDED_GITHUB_ID, catalogPayload, jiraSource, seededSources, source } from "../helpers/sources";

/**
 * The generator card's judgements (#284), one value at a time — every acceptance criterion that is
 * a decision rather than a drawing.
 */

/** No pending clicks. */
const NONE: ReadonlyMap<string, boolean> = new Map();

describe("the batch address", () => {
  it("opens a uuid, the first of several, and nothing else", () => {
    expect(parseBatchParam(SEEDED_BATCH_ID)).toBe(SEEDED_BATCH_ID);
    expect(parseBatchParam([SEEDED_BATCH_ID, "other"])).toBe(SEEDED_BATCH_ID);
    expect(parseBatchParam("OTA-1")).toBeNull();
    expect(parseBatchParam(undefined)).toBeNull();
    expect(parseBatchParam([])).toBeNull();
  });

  it("writes /planning?batch=<id>", () => {
    expect(batchHref("/planning", SEEDED_BATCH_ID)).toBe(`/planning?batch=${SEEDED_BATCH_ID}`);
  });
});

describe("trackerOptions", () => {
  it("draws the mockup's three kinds in its order, with their monograms and tints", () => {
    const options = trackerOptions(seededSources(), { ok: true, value: writableCatalog() });

    expect(options.map((option) => [option.label, option.monogram, option.tint])).toEqual([
      ["GitHub Issues", "GH", "gh"],
      ["Jira", "JI", "ji"],
      ["Linear", "LN", "ln"],
    ]);
  });

  it("lets a connected, writable source be chosen", () => {
    const [github] = trackerOptions(seededSources(), { ok: true, value: writableCatalog() });

    expect(github).toMatchObject({ sourceId: SEEDED_GITHUB_ID, pushName: "GitHub" });
    expect(github!.reason).toBeUndefined();
  });

  it("disables a read-only kind with the catalog's own reason", () => {
    const [github] = trackerOptions([source()], { ok: true, value: catalogPayload() });

    expect(github!.reason).toBe("This tracker is read-only in Ouroboros — it can sync tickets but not create them.");
  });

  it("disables a connected kind this build has no provider for", () => {
    const options = trackerOptions([jiraSource()], { ok: true, value: writableCatalog() });

    expect(options[1]).toMatchObject({ sourceId: jiraSource().id, reason: unsupportedReason("Jira") });
  });

  it("draws an unconnected kind once, disabled, saying it is not connected", () => {
    const options = trackerOptions([], { ok: true, value: writableCatalog() });

    expect(options.map((option) => option.sourceId)).toEqual([null, null, null]);
    expect(options[2]!.reason).toBe(notConnectedReason("Linear"));
  });

  it("gives two sources of one kind a button each, by display name", () => {
    const second = source({ id: "5eed001a-0000-4000-8000-000000000009", displayName: "GitHub · forge-io" });
    const options = trackerOptions([source(), second], { ok: true, value: writableCatalog() });

    expect(options.slice(0, 2).map((option) => option.label)).toEqual(["GitHub · acme-robotics", "GitHub · forge-io"]);
  });

  it("appends a connected kind the mockup does not draw", () => {
    const gitlab = source({ id: "gl", kind: "gitlab", displayName: "GitLab · acme" });
    const options = trackerOptions([gitlab], { ok: true, value: writableCatalog() });

    expect(options.map((option) => option.label)).toEqual(["GitHub Issues", "Jira", "Linear", "GitLab Issues"]);
  });

  it("disables every kind when the catalog, which carries the capability, could not be read", () => {
    const options = trackerOptions(seededSources(), { ok: false, reason: "down" });

    expect(options.every((option) => option.reason !== undefined)).toBe(true);
    expect(options[0]!.reason).toBe(CATALOG_UNREAD_REASON);
  });
});

describe("initialTracker", () => {
  const options: TrackerOption[] = trackerOptions(seededSources(), { ok: true, value: writableCatalog() });

  it("opens on the batch's own tracker", () => {
    expect(initialTracker(options, SEEDED_GITHUB_ID)).toBe(SEEDED_GITHUB_ID);
  });

  it("otherwise opens on the first choosable tracker, or none", () => {
    expect(initialTracker(options, null)).toBe(SEEDED_GITHUB_ID);
    expect(initialTracker(trackerOptions([], { ok: true, value: writableCatalog() }), null)).toBeNull();
  });
});

describe("drafting", () => {
  const form: GeneratorForm = {
    prompt: "  Survive power loss.  ",
    outline: "  ",
    sourceId: SEEDED_GITHUB_ID,
    milestone: { mode: "new", name: " Helios 2.2 " },
    autoSize: true,
    queueSmall: true,
  };

  it("sends the prompt trimmed, a blank outline as null, the milestone by name and both flags", () => {
    expect(generateBody(form)).toEqual({
      prompt: "Survive power loss.",
      outline: null,
      targetSourceId: SEEDED_GITHUB_ID,
      milestone: "Helios 2.2",
      autoSize: true,
      queueSmall: true,
      localKeyPrefix: LOCAL_KEY_PREFIX,
    });
  });

  it("reads a milestone left blank, or none, as no milestone", () => {
    expect(milestoneValue({ mode: "none" })).toBeNull();
    expect(milestoneValue({ mode: "new", name: "  " })).toBeNull();
    expect(milestoneValue({ mode: "existing", name: "Helios 2.1" })).toBe("Helios 2.1");
  });

  it("refuses a viewer, a card already busy, no tracker and no prompt — in that order", () => {
    expect(draftReason(form, false, null)).toBe(DRAFT_ROLE_REASON);
    expect(draftReason(form, true, DRAFTING)).toBe(DRAFTING);
    expect(draftReason({ ...form, sourceId: null }, true, null)).toBe(NO_TRACKER_REASON);
    expect(draftReason({ ...form, prompt: " " }, true, null)).toBe(NO_PROMPT_REASON);
    expect(draftReason(form, true, null)).toBeUndefined();
  });
});

describe("the draft list", () => {
  it("heads the list with the mockup's count", () => {
    expect(draftHeading(6)).toBe("Draft — 6 tickets");
    expect(draftHeading(1)).toBe("Draft — 1 ticket");
  });

  it("tags the estimator with the pipeline's real version, and claims none before one answered", () => {
    expect(estimatorTag(planningBatch())).toBe("estimator v0");
    expect(estimatorTag(planningBatch({ summary: { ...planningBatch().summary, estimators: ["heuristic-v0", "llm-v1"] } }))).toBe(
      "estimator v0, v1",
    );
    expect(estimatorTag(planningBatch({ summary: { ...planningBatch().summary, estimators: [] } }))).toBeNull();
    expect(estimatorTag(null)).toBeNull();
  });

  it("says all sized only when every draft has an estimate", () => {
    const drafts = seededDrafts();

    expect(allSized(drafts)).toBe(true);
    expect(allSized([...drafts.slice(0, 5), planningDraft({ localKey: "OTA-6", estimate: null })])).toBe(false);
    expect(allSized([])).toBe(false);
  });

  it("counts sizing progress", () => {
    expect(sizingProgress([planningDraft(), planningDraft({ estimate: null })])).toBe("sized 1 of 2");
  });

  it("draws an effort chip, sizing… while the estimator works, and unsized when nothing will size it", () => {
    expect(rowSizing(planningDraft(), true)).toEqual({ state: "sized", effort: "L" });
    expect(rowSizing(planningDraft({ estimate: null }), true)).toEqual({ state: "sizing" });
    expect(rowSizing(planningDraft({ estimate: null }), false)).toEqual({ state: "unsized" });
  });

  it("notes what a draft blocks — the inverse of what blocks it", () => {
    const drafts = seededDrafts();

    expect(drafts.map((draft) => blocksNote(draft, drafts))).toEqual([
      "blocks OTA-3",
      "blocks OTA-3",
      "blocks OTA-5",
      "blocks OTA-5",
      null,
      null,
    ]);
  });

  it("lays pending clicks over the stored selection, and counts the live selection", () => {
    const drafts = seededDrafts();
    const pending = new Map([["OTA-2", false], ["OTA-4", false]]);

    expect(isSelected(drafts[1]!, pending)).toBe(false);
    expect(selectedCount(drafts, NONE)).toBe(6);
    expect(selectedCount(drafts, pending)).toBe(4);
  });
});

describe("editing and selecting", () => {
  const batch = planningBatch();

  it("keeps a pushed draft's content with the tracker", () => {
    expect(editReason(planningDraft({ pushState: "pushed" }), batch, true, false)).toBe(PUSHED_EDIT_REASON);
  });

  it("refuses a viewer, a running push and a closed batch", () => {
    expect(editReason(planningDraft(), batch, false, false)).toBe(DRAFT_ROLE_REASON);
    expect(editReason(planningDraft(), batch, true, true)).toBe(PUSH_RUNNING_REASON);
    expect(editReason(planningDraft(), planningBatch({ status: "pushed" }), true, false)).toBe(BATCH_CLOSED_REASON);
    expect(editReason(planningDraft(), batch, true, false)).toBeUndefined();

    expect(selectReason(batch, false, false)).toBe(DRAFT_ROLE_REASON);
    expect(selectReason(batch, true, true)).toBe(PUSH_RUNNING_REASON);
    expect(selectReason(planningBatch({ status: "abandoned" }), true, false)).toBe(BATCH_CLOSED_REASON);
    expect(selectReason(batch, true, false)).toBeUndefined();
  });

  it("sends a trimmed title and a blank body as null", () => {
    expect(editBody("  A/B slots  ", "  ")).toEqual({ title: "A/B slots", body: null });
    expect(editBody("A/B slots", "- two slots")).toEqual({ title: "A/B slots", body: "- two slots" });
  });
});

describe("push states", () => {
  it("links a pushed draft as pushed ✓ #612", () => {
    const draft = planningDraft({
      pushState: "pushed",
      pushedTicket: { externalId: "612", externalKey: "#612", url: "https://github.com/a/b/issues/612" },
    });

    expect(rowPush(draft, true, false)).toEqual({
      state: "pushed",
      text: "pushed ✓ #612",
      href: "https://github.com/a/b/issues/612",
    });
    expect(rowPush({ ...draft, pushedTicket: null }, true, false)).toEqual({ state: "pushed", text: "pushed ✓", href: null });
  });

  it("says failed with the reason, and pushing… for a selected draft while a push runs", () => {
    const failed = planningDraft({ pushState: "failed", pushError: { code: "rate_limited", message: "rate limited" } });

    expect(rowPush(failed, true, false)).toEqual({ state: "failed", text: "failed — rate limited" });
    expect(rowPush({ ...failed, pushError: null }, true, false)).toEqual({ state: "failed", text: "failed" });
    expect(rowPush(failed, true, true)).toEqual({ state: "pushing" });
    expect(rowPush(planningDraft(), false, true)).toEqual({ state: "none" });
  });

  it("offers push, then resume while something selected did not land, then nothing", () => {
    const drafts = seededDrafts();
    const partial = drafts.map((draft, index) => ({ ...draft, pushState: index < 4 ? ("pushed" as const) : ("failed" as const) }));
    const done = drafts.map((draft) => ({ ...draft, pushState: "pushed" as const }));

    expect(pushMode(drafts, NONE)).toBe("push");
    expect(pushMode(partial, NONE)).toBe("resume");
    // Deselecting the two that failed leaves nothing to resume.
    expect(pushMode(partial, new Map([["OTA-5", false], ["OTA-6", false]]))).toBe("done");
    expect(pushMode(done, NONE)).toBe("done");
  });

  it("labels the push with the live count and the tracker", () => {
    expect(pushLabel(6, "GitHub")).toBe("Push 6 tickets to GitHub →");
    expect(pushLabel(1, "Jira")).toBe("Push 1 ticket to Jira →");
  });

  it("refuses a member, an unwritable tracker, a busy card, a finished push and an empty selection", () => {
    const [github] = trackerOptions(seededSources(), { ok: true, value: writableCatalog() });
    const readOnly = { ...github!, reason: "read-only" };
    const input = { mode: "push" as const, count: 6, tracker: github, mayAdminister: true, busy: null };

    expect(pushReason({ ...input, mayAdminister: false })).toBe(PUSH_ROLE_REASON);
    expect(pushReason({ ...input, tracker: undefined })).toMatch(/not connected/);
    expect(pushReason({ ...input, tracker: readOnly })).toBe("read-only");
    expect(pushReason({ ...input, busy: "Pushing…" })).toBe("Pushing…");
    expect(pushReason({ ...input, mode: "done" })).toBe(allPushedReason("GitHub"));
    expect(pushReason({ ...input, count: 0 })).toBe(NOTHING_SELECTED_REASON);
    expect(pushReason(input)).toBeUndefined();
  });

  it("closes regenerate for a viewer, a busy card and a pushed batch", () => {
    expect(regenerateReason(planningBatch(), false, null)).toBe(DRAFT_ROLE_REASON);
    expect(regenerateReason(planningBatch(), true, "Pushing…")).toBe("Pushing…");
    expect(regenerateReason(planningBatch({ status: "pushed" }), true, null)).toBe(BATCH_CLOSED_REASON);
    // A push that stopped short leaves `pushing`, and may still be re-planned.
    expect(regenerateReason(planningBatch({ status: "pushing" }), true, null)).toBeUndefined();
  });
});

describe("the footer", () => {
  it("is the mockup's line for the seeded batch", () => {
    expect(footerText(planningBatch())).toBe("est. total ~3 days of loop time · $14 est. spend");
  });

  it("omits the $ entirely when nothing is priced", () => {
    const { spend, ...unpriced } = planningBatch().summary;
    void spend;

    expect(footerText(planningBatch({ summary: unpriced }))).toBe("est. total ~3 days of loop time");
  });

  it("writes a partial price as a floor", () => {
    const summary = { ...planningBatch().summary, spend: { cents: 1400, display: "$14", partial: true } };

    expect(footerText(planningBatch({ summary }))).toBe("est. total ~3 days of loop time · $14+ est. spend");
  });

  it("says so far while a selected draft is unsized, and nothing selected when nothing is", () => {
    const drafts = [...seededDrafts().slice(0, 5), planningDraft({ localKey: "OTA-6", estimate: null })];

    expect(footerText(planningBatch({ drafts }))).toMatch(/of loop time so far/);
    expect(footerText(planningBatch({ summary: { ...planningBatch().summary, selectedCount: 0 } }))).toBe(
      NOTHING_SELECTED_FOOTER,
    );
  });

  it("writes days to one decimal, and one day singular", () => {
    expect(formatDays(3)).toBe("3 days");
    expect(formatDays(3.14)).toBe("3.1 days");
    expect(formatDays(0.375)).toBe("0.4 days");
    expect(formatDays(1)).toBe("1 day");
  });
});

describe("pushOutcome", () => {
  it("says how many were pushed", () => {
    expect(pushOutcome(pushResult(), "GitHub")).toEqual(["Pushed 6 tickets to GitHub."]);
  });

  it("says a partial push left some behind, and that resume re-runs only those", () => {
    const report = pushResult().report;
    const drafts = report.drafts.map((draft, index) =>
      index < 4 ? draft : { ...draft, pushState: "failed" as const, ticket: null, ticketId: null },
    );

    expect(pushOutcome(pushResult({ outcome: "partial", pushedThisRun: 4, drafts }), "GitHub")).toEqual([
      "Pushed 4 tickets to GitHub; 2 tickets did not land — Resume push re-runs only those.",
    ]);
  });

  it("names the rate limit and when to resume", () => {
    const drafts = pushResult().report.drafts.map((draft) => ({ ...draft, pushState: "pending" as const }));

    expect(
      pushOutcome(pushResult({ outcome: "throttled", pushedThisRun: 0, retryAt: "2026-09-17T14:20:00.000Z", drafts }), "GitHub"),
    ).toEqual(["GitHub is rate limiting — 6 tickets did not land. Resume push after 14:20 UTC."]);
  });

  it("reports what queue-small queued and skipped", () => {
    const result = {
      ...pushResult(),
      queueSmall: {
        queued: ["OTA-6"],
        skipped: [{ localKey: "OTA-2", reason: "not_yet_mirrored" as const }],
      },
    };

    expect(pushOutcome(result, "GitHub")).toEqual([
      "Pushed 6 tickets to GitHub.",
      "Queued OTA-6.",
      "OTA-2 not queued — not mirrored yet.",
    ]);
  });
});
