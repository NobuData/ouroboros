import { describe, expect, it } from "vitest";

import {
  CAPTURE_READ_ONLY,
  ENABLE_FAILED,
  ENABLE_READ_ONLY,
  HEALTH_CYCLE_SECONDS,
  RESEARCH_SIDE_ENDPOINT,
  TOOL_CONFIG_INVALID,
  WATCH_CAPTION,
  captureSummary,
  connectedTag,
  dismissName,
  dotLabel,
  enableFailure,
  enableFields,
  enableName,
  enableSubmission,
  isOpen,
  isResearchSide,
  needsRepro,
  offersEnable,
  plannedIssueLabel,
  plannedIssueUrl,
  plannedNote,
  sideReadings,
  watchFragments,
  watchMetricName,
  watchRows,
  watchTitle,
} from "@/app/research/side";

import {
  emptyWatch,
  needsReproItem,
  plainForm,
  seededCatalog,
  seededTools,
  seededWatch,
  seededWatchItems,
  tool,
  watchItem,
} from "../helpers/research";

/**
 * The Research side column's model (CN.3, #629): what counts as its payload, which reading a card
 * draws, and how a tool row and a watch row are composed from what the service said.
 */

const WEB_FORM = {
  kind: "form" as const,
  title: "Web search & page reader",
  values: { provider: "brave", domains: ["a.example", "b.example"] },
  fields: [
    { ...plainForm("x").fields[0], name: "provider", label: "Search provider", widget: "select" as const, choices: ["searxng", "brave"], defaultValue: "searxng" },
    { ...plainForm("x").fields[0], name: "domains", label: "Domains", widget: "list" as const },
    { ...plainForm("x").fields[0], name: "apiKey", label: "API key", widget: "secret" as const },
    { ...plainForm("x").fields[0], name: "searxngUrl", label: "SearXNG URL", widget: "url" as const },
  ],
};

describe("the side column's payload", () => {
  it("is asked for at this origin, once per health cycle", () => {
    expect(RESEARCH_SIDE_ENDPOINT).toBe("/api/research/side");
    expect(HEALTH_CYCLE_SECONDS).toBe(30);
  });

  it("is both cards together", () => {
    expect(isResearchSide({ tools: seededCatalog(), watch: seededWatch() })).toBe(true);
    expect(isResearchSide({ tools: seededCatalog([]), watch: emptyWatch() })).toBe(true);
  });

  it.each([
    ["nothing", null],
    ["a string", "side"],
    ["the tools alone", { tools: seededCatalog() }],
    ["the watch alone", { watch: seededWatch() }],
    ["tools that are not a list", { tools: { tools: 6 }, watch: seededWatch() }],
    ["null tools", { tools: null, watch: seededWatch() }],
    ["a watch without items", { tools: seededCatalog(), watch: { headline: null } }],
  ])("is not %s", (_name, value) => {
    expect(isResearchSide(value)).toBe(false);
  });

  it("draws the page's readings until a poll answers, then the poll's", () => {
    const readings = {
      tools: { ok: false as const, reason: "down" },
      watch: { ok: true as const, value: emptyWatch() },
    };

    expect(sideReadings(readings, null)).toBe(readings);
    expect(sideReadings(readings, { tools: seededCatalog(), watch: seededWatch() })).toEqual({
      tools: { ok: true, value: seededCatalog() },
      watch: { ok: true, value: seededWatch() },
    });
  });
});

describe("a tool row", () => {
  it("prints the service's count in the tag", () => {
    expect(connectedTag(seededCatalog())).toBe("5 connected");
    expect(connectedTag(seededCatalog([]))).toBe("0 connected");
  });

  it("describes each dot in words, with the service's detail", () => {
    const [web, , , , , docs] = seededTools();

    expect(dotLabel(web)).toBe("Healthy — 200 · 41ms");
    expect(dotLabel(docs)).toBe("Not enabled — not configured");
    expect(dotLabel(tool("web", "Web", "◍", "x", { health: { state: "down", dot: "err", detail: "unreachable" } }))).toBe(
      "Down — unreachable",
    );
    expect(dotLabel(tool("web", "Web", "◍", "x", { health: { state: "degraded", dot: "warn", detail: "slow" } }))).toBe(
      "Degraded — slow",
    );
  });

  it("offers enable on an idle row that can say what enabling opens, and nowhere else", () => {
    const [web, , , , , docs] = seededTools();
    const idle = { state: "not_configured" as const, dot: "idle" as const, detail: "not configured" };

    expect(offersEnable(web)).toBe(false);
    expect(offersEnable(docs)).toBe(true);
    expect(offersEnable({ ...web, health: idle })).toBe(true);
    expect(offersEnable({ ...web, health: idle, enable: null })).toBe(false);
    expect(offersEnable({ ...web, health: { state: "down", dot: "err", detail: "x" } })).toBe(false);
    expect(enableName(docs)).toBe("Enable Docs, standards & papers");
  });

  it("says when a planned tool arrives and where to follow it", () => {
    expect(plannedNote("Docs, standards & papers", "v2")).toContain("Docs, standards & papers arrives in v2.");
    expect(plannedIssueUrl(635)).toBe("https://github.com/NobuData/ouroboros/issues/635");
    expect(plannedIssueLabel(635)).toBe("Follow #635");
  });
});

describe("the enable form", () => {
  it("starts each field from what is stored, and never the credential", () => {
    const fields = enableFields({ ...WEB_FORM, values: { ...WEB_FORM.values, apiKey: "leaked" } });

    expect(fields.map((field) => [field.name, field.defaultValue])).toEqual([
      ["provider", "brave"],
      ["domains", "a.example\nb.example"],
      ["apiKey", null],
      ["searxngUrl", null],
    ]);
  });

  it("keeps the schema's default for a field nothing is stored for", () => {
    expect(enableFields({ ...WEB_FORM, values: {} })[0].defaultValue).toBe("searxng");
  });

  it("submits what was typed in the schema's vocabulary, leaving untouched optional fields out", () => {
    const typed: Record<string, string> = { provider: " brave ", domains: "a.example\n\nb.example", apiKey: "BSA-key" };

    expect(enableSubmission(WEB_FORM, (name) => typed[name] ?? "")).toEqual({
      provider: "brave",
      domains: ["a.example", "b.example"],
      apiKey: "BSA-key",
    });
    expect(enableSubmission(plainForm("Code"), () => "")).toEqual({});
  });

  it("prints the schema's complaints against their fields", () => {
    expect(
      enableFailure({
        code: "research_tool_config_invalid",
        message: "The configuration does not satisfy this tool's schema.",
        details: { tool: "web", fields: { provider: ["must be one of searxng, brave"], junk: "no", n: [1] } },
      }),
    ).toEqual({ message: TOOL_CONFIG_INVALID, fields: { provider: ["must be one of searxng, brave"] } });
  });

  it("prints a role refusal, the service's own sentence, or its fallback", () => {
    expect(enableFailure({ code: "forbidden", message: "Forbidden.", details: {} })).toEqual({
      message: ENABLE_READ_ONLY,
      fields: {},
    });
    expect(enableFailure({ code: "research_tool_not_registered", message: "No adapter.", details: {} }).message).toBe(
      "No adapter.",
    );
    expect(enableFailure({ code: "x", message: "", details: {} }).message).toBe(ENABLE_FAILED);
    expect(enableFailure({ code: "research_tool_config_invalid", message: "", details: {} }).fields).toEqual({});
  });
});

describe("a watch row", () => {
  it("names a metric in words, dropping a trailing unit only when it is the samples' own", () => {
    const named = (metricLabel: string, unit: string) =>
      watchMetricName(watchItem({ metricLabel, baseline: { ...watchItem().baseline, unit } }));

    expect(named("hover_drift_cm", "cm")).toBe("Hover drift");
    expect(named("boot_time_ms", "ms")).toBe("Boot time");
    expect(named("soc_error_pct", "%")).toBe("Soc error");
    expect(named("hover_drift_cm", "mm")).toBe("Hover drift cm");
    expect(named("merge_rate", "%")).toBe("Merge rate");
    expect(named("ms", "ms")).toBe("Ms");
    expect(named("p95__latency_", "s")).toBe("P95 latency");
  });

  it("is titled by the metric, its signed drift and the release it is measured against", () => {
    expect(seededWatchItems().map(watchTitle)).toEqual([
      "Hover drift +14% since v2.0.4",
      "Boot time +230 ms since v2.1.0-rc1",
      "Soc error +2.8% since v2.0.4",
    ]);
    expect(dismissName(watchItem())).toBe("Dismiss Hover drift +14% since v2.0.4");
  });

  it("links the commit and the run for a fix in flight", () => {
    expect(watchFragments(watchItem())).toEqual([
      [
        { text: "bisected → ", href: null, external: false, mono: false },
        {
          text: "a41f2c9",
          href: "https://github.com/acme-robotics/helios-firmware/commit/a41f2c95d0b7e31c8a64f20e9d1b37c55a8f06e2",
          external: true,
          mono: true,
        },
      ],
      [{ text: "fix loop running", href: null, external: false, mono: false }],
      [
        {
          text: "#512",
          href: "/runs/5eed0009-0000-4000-8000-000000000512?from=research",
          external: false,
          mono: true,
        },
      ],
    ]);
  });

  it("links a ticket no run has touched to its tracker page", () => {
    const [, queued] = seededWatchItems();

    expect(watchFragments(queued)[2]).toEqual([
      {
        text: "#517",
        href: "https://github.com/acme-robotics/helios-firmware/issues/517",
        external: true,
        mono: true,
      },
    ]);
  });

  it("leaves a draft's key as the words it is — a draft has no page of its own", () => {
    const draft = watchItem({
      detail: "bisected → a41f2c9 · fix ticket drafted · FIX-1",
      fixTicket: { kind: "draft", id: "d4af7000-0000-4000-8000-000000000001", key: "FIX-1" },
      fixRun: null,
      fixTicketUrl: null,
    });

    expect(watchFragments(draft)[2]).toEqual([{ text: "FIX-1", href: null, external: false, mono: true }]);
  });

  it("links the merged pull request", () => {
    const [, , merged] = seededWatchItems();

    expect(watchFragments(merged)).toEqual([
      [{ text: "root-caused, fixed & merged", href: null, external: false, mono: false }],
      [
        {
          text: "PR #641",
          href: "/prs/5eed0098-0000-4000-8000-000000000641?from=research",
          external: false,
          mono: true,
        },
      ],
    ]);
  });

  it("keeps a part it does not recognise as plain words", () => {
    expect(watchFragments(watchItem({ detail: "bisecting on the build farm", bisect: null }))).toEqual([
      [{ text: "bisecting on the build farm", href: null, external: false, mono: false }],
    ]);
  });

  it("knows a needs-repro item, and keeps its explanation as the sub-line", () => {
    const item = needsReproItem();

    expect(needsRepro(item)).toBe(true);
    expect(needsRepro(watchItem())).toBe(false);
    expect(needsRepro({ ...item, status: "bisected" })).toBe(false);
    expect(needsRepro({ ...item, note: null })).toBe(false);
    expect(watchFragments(item)).toEqual([[{ text: item.detail, href: null, external: false, mono: false }]]);
  });

  it("draws every item but a dismissed one, and lets only an open one be dismissed", () => {
    const dismissed = watchItem({ id: "x", status: "dismissed" });
    const [fixing, queued, merged] = seededWatchItems();

    expect(watchRows(seededWatch({ items: [fixing, dismissed, merged] }))).toEqual([fixing, merged]);
    expect([fixing, queued, merged, dismissed, needsReproItem()].map(isOpen)).toEqual([
      true,
      true,
      false,
      false,
      true,
    ]);
  });
});

describe("what the card says", () => {
  it("prints mockup 22's caption verbatim", () => {
    expect(WATCH_CAPTION).toBe(
      "Watch compares every nightly HIL run to the last release baseline; any drift opens a forensics investigation automatically.",
    );
  });

  it("sums a capture up, with what was skipped and why", () => {
    expect(captureSummary(2, [])).toBe("Captured 2 baselines.");
    expect(captureSummary(1, [])).toBe("Captured 1 baseline.");
    expect(captureSummary(0, [{ metric: "boot_time_ms", reason: "too few samples" }])).toBe(
      "No baseline was captured. Skipped: boot_time_ms (too few samples).",
    );
    expect(CAPTURE_READ_ONLY).toMatch(/owners and admins/);
  });
});
