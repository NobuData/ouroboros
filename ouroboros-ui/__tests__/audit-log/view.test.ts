import { describe, expect, it } from "vitest";

import {
  ACTOR_KINDS,
  ACTOR_KIND_CLASS,
  ACTOR_KIND_LABELS,
  AUDIT_ADMINS_ONLY,
  BOT_SERVICE,
  DAY_INVALID,
  EMPTY_FORM,
  EXPORT_MAX_DAYS,
  EXPORT_RANGE_REQUIRED,
  EXPORT_RANGE_TOO_LONG,
  EXPORT_ROUTE,
  PLANE_INVALID,
  RANGE_REVERSED,
  REF_INVALID,
  actorFilter,
  actorOptions,
  auditUnread,
  dayOf,
  dayStart,
  defaultExportRange,
  endOfLog,
  exportHref,
  exportRangeError,
  filterSummary,
  mergeEvents,
  normalisePlane,
  normaliseRef,
  parseFilterForm,
  retainedTag,
  stampOf,
} from "@/app/audit-log/view";

import { auditLogEvents } from "../helpers/audit-log";
import { JORGE, KEN, MAYA, SERVICE_LIST, membersPage } from "../helpers/members";

/**
 * The Audit card's rules (BS.5, #495): what the filter form becomes on the wire, the export's
 * bounded range at its boundary, and the sentences.
 */

describe("the rows", () => {
  it("prints the retention tag from the tier it is given", () => {
    expect(retainedTag(400)).toBe("retained 400d");
    expect(retainedTag(730)).toBe("retained 730d");
  });

  it("stamps a log row with its UTC date and time", () => {
    expect(stampOf("2026-10-05T14:31:22.000Z")).toBe("2026-10-05 14:31");
    expect(stampOf("2026-10-05T23:30:00.000-02:00")).toBe("2026-10-06 01:30");
    expect(stampOf("not a date")).toBe("not a date");
  });

  it("has a distinct class and a word for every actor kind", () => {
    expect(new Set(ACTOR_KINDS.map((kind) => ACTOR_KIND_CLASS[kind])).size).toBe(4);
    expect(new Set(ACTOR_KINDS.map((kind) => ACTOR_KIND_LABELS[kind])).size).toBe(4);
  });

  it("ends a list by saying how many events it holds", () => {
    expect(endOfLog(37)).toBe("End of log · 37 events");
    expect(endOfLog(1)).toBe("End of log · 1 event");
  });

  it("appends a page without drawing any event twice", () => {
    const first = auditLogEvents(3, "a");
    const second = [first[2], ...auditLogEvents(2, "b")];

    expect(mergeEvents(first, second).map((event) => event.id)).toEqual(["a-0", "a-1", "a-2", "b-0", "b-1"]);
  });
});

describe("who the seat is for", () => {
  it("says who reads the log, with and without a failure to report", () => {
    expect(AUDIT_ADMINS_ONLY).toMatch(/owners and admins/);
    expect(auditUnread("The service is restarting.")).toBe(
      "The audit log is read by owners and admins, and could not be read here: The service is restarting.",
    );
  });
});

describe("actorOptions", () => {
  it("lists people by user id, service accounts by name, and always the bot", () => {
    expect(actorOptions(membersPage(), SERVICE_LIST)).toEqual([
      ...[KEN, MAYA, JORGE].map((member) => ({ value: `id:${member.userId}`, label: member.name })),
      { value: "service:devops-bot", label: "service:devops-bot" },
      { value: `service:${BOT_SERVICE}`, label: "ouroboros-app[bot]" },
    ]);
  });

  it("falls back to the members page's service rows, and to the bot alone", () => {
    expect(actorOptions(membersPage(), null).map((option) => option.value)).toContain("service:devops-bot");
    expect(actorOptions(null, null)).toEqual([{ value: "service:ouroboros-app", label: "ouroboros-app[bot]" }]);
  });

  it("maps an option to the part of the filter it stands for", () => {
    expect(actorFilter("id:user-ken")).toEqual({ actorId: "user-ken" });
    expect(actorFilter("service:devops-bot")).toEqual({ actorService: "devops-bot" });
    expect(actorFilter("")).toEqual({});
    expect(actorFilter("ken")).toEqual({});
  });
});

describe("days", () => {
  it("reads a UTC day and refuses what is not one", () => {
    expect(dayStart("2026-10-05")).toBe(Date.parse("2026-10-05T00:00:00.000Z"));
    expect(dayStart("2026-02-31")).toBeNull();
    expect(dayStart("05/10/2026")).toBeNull();
    expect(dayStart("")).toBeNull();
  });

  it("names the UTC day an instant falls on", () => {
    expect(dayOf("2026-10-05T00:00:00.000Z")).toBe("2026-10-05");
    expect(dayOf(Date.parse("2026-10-05T23:59:59.999Z"))).toBe("2026-10-05");
    expect(dayOf("nope")).toBe("");
  });
});

describe("parseFilterForm", () => {
  it("sends nothing for an empty form", () => {
    expect(parseFilterForm(EMPTY_FORM)).toEqual({ ok: true, filter: {} });
  });

  it("makes the last day inclusive: `to` is the midnight after it", () => {
    expect(parseFilterForm({ ...EMPTY_FORM, from: "2026-10-01", to: "2026-10-05" })).toEqual({
      ok: true,
      filter: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" },
    });
    // One day is a range of one day.
    expect(parseFilterForm({ ...EMPTY_FORM, from: "2026-10-05", to: "2026-10-05" })).toMatchObject({
      ok: true,
    });
  });

  it("builds every dimension the service filters on", () => {
    expect(
      parseFilterForm({
        from: "2026-10-01",
        to: "",
        actorKind: "human",
        actor: "id:user-ken",
        plane: " Policy ",
        ref: "#509",
      }),
    ).toEqual({
      ok: true,
      filter: {
        from: "2026-10-01T00:00:00.000Z",
        actorKind: "human",
        actorId: "user-ken",
        action: "policy.*",
        ref: "pr:509",
      },
    });
    expect(parseFilterForm({ ...EMPTY_FORM, actor: "service:devops-bot", plane: "policy.published" })).toEqual({
      ok: true,
      filter: { actorService: "devops-bot", action: "policy.published" },
    });
  });

  it("normalises a plane and a reference to the service's spelling", () => {
    expect(normalisePlane("policy")).toBe("policy.*");
    expect(normalisePlane("policy.*")).toBe("policy.*");
    expect(normalisePlane("")).toBe("");
    expect(normaliseRef("#509")).toBe("pr:509");
    expect(normaliseRef("PR 509")).toBe("pr:509");
    expect(normaliseRef("pr#509")).toBe("pr:509");
    expect(normaliseRef(" run:abc ")).toBe("run:abc");
  });

  it("refuses what the service would, per field, and sends nothing", () => {
    expect(
      parseFilterForm({
        from: "2026-10-05",
        to: "2026-10-01",
        actorKind: "",
        actor: "",
        plane: "Policy Plane",
        ref: "509 please",
      }),
    ).toEqual({ ok: false, errors: { to: RANGE_REVERSED, plane: PLANE_INVALID, ref: REF_INVALID } });
    expect(parseFilterForm({ ...EMPTY_FORM, from: "2026-02-31" })).toEqual({
      ok: false,
      errors: { from: DAY_INVALID },
    });
    expect(parseFilterForm({ ...EMPTY_FORM, ref: "issue:12" })).toMatchObject({ ok: false });
  });
});

describe("filterSummary", () => {
  it("lists what narrows the view, naming an actor rather than printing an id", () => {
    const actors = actorOptions(membersPage(), SERVICE_LIST);

    expect(
      filterSummary(
        { from: "2026-10-01T00:00:00.000Z", actorKind: "human", actorId: KEN.userId, action: "policy.*", ref: "pr:509" },
        actors,
      ),
    ).toEqual(["Actor kind: person", `Actor: ${KEN.name}`, "Plane or action: policy.*", "Reference: pr:509"]);
    expect(filterSummary({ actorService: "ouroboros-app" }, actors)).toEqual(["Actor: ouroboros-app[bot]"]);
    expect(filterSummary({ actorId: "gone" }, actors)).toEqual(["Actor: id:gone"]);
  });

  it("is empty for a filter that only sets a range", () => {
    expect(filterSummary({ from: "2026-10-01T00:00:00.000Z" }, [])).toEqual([]);
  });
});

describe("the export's range", () => {
  const NOW = new Date("2026-10-05T10:00:00.000Z");

  it("opens on the last thirty days, ending today", () => {
    expect(defaultExportRange(NOW)).toEqual({ from: "2026-09-06", to: "2026-10-05" });
  });

  it("opens on the applied filter's range, its exclusive end shown as the day before", () => {
    expect(
      defaultExportRange(NOW, { from: "2026-08-01T00:00:00.000Z", to: "2026-08-15T00:00:00.000Z" }),
    ).toEqual({ from: "2026-08-01", to: "2026-08-14" });
    expect(defaultExportRange(NOW, { from: "2026-10-05T00:00:00.000Z" })).toEqual({
      from: "2026-10-05",
      to: "2026-10-05",
    });
    expect(defaultExportRange(NOW, { to: "2026-08-15T00:00:00.000Z" })).toEqual({
      from: "2026-07-16",
      to: "2026-08-14",
    });
  });

  it("is bounded at 366 days, exactly", () => {
    expect(EXPORT_MAX_DAYS).toBe(366);
    // 2026-01-01 … 2027-01-01 inclusive is 366 days: the last range the service takes.
    expect(exportRangeError({ from: "2026-01-01", to: "2027-01-01" })).toBeNull();
    expect(exportRangeError({ from: "2026-01-01", to: "2027-01-02" })).toBe(EXPORT_RANGE_TOO_LONG);
    expect(exportRangeError({ from: "2026-10-05", to: "2026-10-05" })).toBeNull();
  });

  it("needs both days, real ones, in order", () => {
    expect(exportRangeError({ from: "", to: "2026-10-05" })).toBe(EXPORT_RANGE_REQUIRED);
    expect(exportRangeError({ from: "2026-10-05", to: "" })).toBe(EXPORT_RANGE_REQUIRED);
    expect(exportRangeError({ from: "2026-02-31", to: "2026-10-05" })).toBe(DAY_INVALID);
    expect(exportRangeError({ from: "2026-10-05", to: "2026-10-01" })).toBe(RANGE_REVERSED);
  });

  it("addresses the route with the range and every applied filter — the filter's own range replaced", () => {
    const href = exportHref(
      { from: "2026-09-06", to: "2026-10-05" },
      { from: "2020-01-01T00:00:00.000Z", to: "2020-01-02T00:00:00.000Z", actorKind: "bot", ref: "pr:509" },
    );
    const url = new URL(href, "http://ui.test");

    expect(url.pathname).toBe(EXPORT_ROUTE);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-09-06T00:00:00.000Z",
      to: "2026-10-06T00:00:00.000Z",
      actorKind: "bot",
      ref: "pr:509",
    });
  });

  it("the span the address carries never exceeds what the service takes", () => {
    const url = new URL(exportHref({ from: "2026-01-01", to: "2027-01-01" }), "http://ui.test");
    const days =
      (Date.parse(url.searchParams.get("to") ?? "") - Date.parse(url.searchParams.get("from") ?? "")) / 86_400_000;

    expect(days).toBe(366);
  });
});
