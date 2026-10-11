import { describe, expect, it } from "vitest";

import { ADMIN_ONLY_START_REASON, chipState, defaultSelection, startGate, usableTool } from "@/app/research/composer";
import {
  CANCELLED_REASON,
  FAILURE_REASONS,
  FAILURE_UNRECORDED,
  GATEWAY_NOTICE_HREF,
  GATEWAY_START_REASON,
  gatewayAbsent,
  isStopped,
  neverAsked,
  noToolConnected,
  sourcesReached,
  stoppedReason,
} from "@/app/research/states";
import { VIEWER_START_REASON } from "@/app/research/view";

import { investigationDetail, investigationList, seededCatalog, seededKinds, seededTools, tool } from "../helpers/research";

/**
 * Research's states and guards, as decisions (#633): when the gateway counts as absent and what
 * that does to the start gate, when a workspace has no tool to use or has asked nothing, and what
 * a stopped investigation says about itself.
 */

const settings = (available: boolean, startRole: "member" | "admin" = "member") =>
  ({ ok: true as const, value: { startRole, gateway: { available } } });
const unread = { ok: false as const, reason: "The service failed." };

describe("the invocation gateway", () => {
  it("is absent only when the service answered and said so", () => {
    expect(gatewayAbsent(settings(false))).toBe(true);
    expect(gatewayAbsent(settings(true))).toBe(false);
    expect(gatewayAbsent(unread)).toBe(false);
  });

  it("is the start gate's first reason, whatever the reader's role", () => {
    expect(startGate(true, true, settings(false))).toBe(GATEWAY_START_REASON);
    expect(startGate(true, false, settings(false, "admin"))).toBe(GATEWAY_START_REASON);
    expect(startGate(false, false, settings(false))).toBe(GATEWAY_START_REASON);
  });

  it("leaves the role's reasons as they were when the gateway is there or unknown", () => {
    expect(startGate(true, false, settings(true))).toBeNull();
    expect(startGate(false, false, settings(true))).toBe(VIEWER_START_REASON);
    expect(startGate(true, false, settings(true, "admin"))).toBe(ADMIN_ONLY_START_REASON);
    expect(startGate(true, true, settings(true, "admin"))).toBeNull();
    expect(startGate(true, false, unread)).toBeNull();
    expect(startGate(false, false, unread)).toBe(VIEWER_START_REASON);
  });

  it("names the designed explanation and points at Providers", () => {
    expect(GATEWAY_START_REASON).toBe("Research needs the invocation gateway — see Providers.");
    expect(GATEWAY_NOTICE_HREF).toBe("/models/providers");
  });
});

describe("tools a workspace can use", () => {
  const enabled = tool("code", "Codebase & git mining", "⌥", "blame");
  const unconfigured = { ...enabled, configured: false };
  const planned = seededTools()[5]!;

  it("needs both the build's adapter and the workspace's enabling", () => {
    expect(usableTool(enabled)).toBe(true);
    expect(usableTool(unconfigured)).toBe(false);
    expect(usableTool(planned)).toBe(false);
  });

  it("draws an unusable tool's chip idle and never turns it on by default", () => {
    expect(chipState(unconfigured, new Set(["code"]))).toBe("idle");
    expect(chipState(enabled, new Set(["code"]))).toBe("on");

    const gap = seededKinds().find((kind) => kind.slug === "gap_analysis")!;
    const nothing = seededTools().map((entry) => ({ ...entry, configured: false }));

    expect(defaultSelection(gap, nothing)).toEqual([]);
    expect(defaultSelection(gap, seededTools()).length).toBeGreaterThan(0);
  });

  it("counts a catalog as unconnected only when it has tools and none answers", () => {
    expect(noToolConnected({ ...seededCatalog(), connectedCount: 0 })).toBe(true);
    expect(noToolConnected(seededCatalog())).toBe(false);
    expect(noToolConnected({ tools: [], connectedCount: 0 })).toBe(false);
  });
});

describe("a workspace that has asked nothing", () => {
  it("has no active investigation and none this quarter", () => {
    expect(neverAsked(investigationList({ counts: { active: 0, thisQuarter: 0 } }))).toBe(true);
    expect(neverAsked(investigationList({ counts: { active: 0, thisQuarter: 2 } }))).toBe(false);
    expect(neverAsked(investigationList({ counts: { active: 1, thisQuarter: 0 } }))).toBe(false);
  });
});

describe("a stopped investigation", () => {
  it("is a failed or a cancelled one", () => {
    expect(isStopped({ status: "failed" })).toBe(true);
    expect(isStopped({ status: "cancelled" })).toBe(true);
    for (const status of ["queued", "running", "brief_ready", "issues_filed"] as const) {
      expect(isStopped({ status })).toBe(false);
    }
  });

  it("names each reason the loop records, with the loop's detail after it", () => {
    expect(FAILURE_REASONS).toEqual({
      tool_exhaustion: "tools exhausted",
      budget_breach: "budget reached",
      synthesis_failure: "synthesis failed",
      engine_error: "engine error",
    });
    expect(
      stoppedReason(investigationDetail({ status: "failed", failure: { reason: "budget_breach", detail: "$9.00 ceiling." } })),
    ).toBe("budget reached — $9.00 ceiling.");
    expect(
      stoppedReason(investigationDetail({ status: "failed", failure: { reason: "synthesis_failure", detail: "" } })),
    ).toBe("synthesis failed");
  });

  it("says a cancel was a cancel, and admits an unrecorded failure", () => {
    expect(stoppedReason(investigationDetail({ status: "cancelled" }))).toBe(CANCELLED_REASON);
    expect(stoppedReason(investigationDetail({ status: "failed", failure: null }))).toBe(FAILURE_UNRECORDED);
  });

  it("counts the sources it reached", () => {
    expect(sourcesReached(31)).toBe("31 sources reached");
    expect(sourcesReached(1)).toBe("1 source reached");
    expect(sourcesReached(0)).toBe("0 sources reached");
  });
});
