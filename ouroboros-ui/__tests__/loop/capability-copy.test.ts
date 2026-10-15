import { describe, expect, it } from "vitest";

import type { LoopReason } from "@/app/api/loop";
import {
  LIVE_EXECUTION_DOCS,
  REASON_COPY,
  runConsoleNotice,
  stageLive,
  stageNotice,
} from "@/app/loop/capability-copy";

import { deploymentOff, live, withOff } from "../helpers/loop-capabilities";

/** DG.2's whole vocabulary, as `schema.d.ts` lists it. */
const REASONS: readonly LoopReason[] = [
  "not_implemented",
  "no_invocable_connection",
  "deployment_disabled",
  "engine_unavailable",
  "no_task_queue",
  "no_executor",
  "execution_unavailable",
  "no_runner",
  "no_source_checkout",
  "policy_not_dry_run",
];

describe("stageNotice", () => {
  it("says nothing for a live stage", () => {
    expect(stageNotice(live(), "execution")).toBeNull();
  });

  it("says nothing for a report it has not read — no claim either way", () => {
    expect(stageNotice(null, "execution")).toBeNull();
    expect(stageLive(null, "execution")).toBe(false);
  });

  it("gives every reason but execution_unavailable a sentence and a fix", () => {
    for (const reason of REASONS.filter((code) => code !== "execution_unavailable")) {
      const copy = REASON_COPY[reason as Exclude<LoopReason, "execution_unavailable">];

      expect(copy.sentence, reason).toMatch(/\.$/);
      expect(copy.fix.href, reason).not.toBe("");
    }
  });

  it("names execution's reason for a stage that waits on it", () => {
    const notice = stageNotice(deploymentOff(), "prPublishing");

    expect(notice?.reason).toBe("deployment_disabled");
    expect(notice?.sentence).toBe("Live execution is off for this deployment — ask an administrator.");
    expect(notice?.fix).toEqual({ label: "How to enable", href: LIVE_EXECUTION_DOCS, external: true });
  });

  it("links the fix in the application where there is one", () => {
    expect(stageNotice(withOff({ invocation: "no_invocable_connection" }), "invocation")?.fix.href).toBe(
      "/models/providers",
    );
    expect(stageNotice(withOff({ buildIntegration: "no_runner" }), "buildIntegration")?.fix.href).toBe(
      "/build-farm",
    );
    expect(stageNotice(withOff({ prPublishing: "policy_not_dry_run" }), "prPublishing")?.fix.href).toBe(
      "/settings#policies",
    );
  });
});

describe("runConsoleNotice — the issue's diagram", () => {
  it("execution off → execution's reason", () => {
    expect(runConsoleNotice(deploymentOff())?.reason).toBe("deployment_disabled");
    expect(runConsoleNotice(withOff({ execution: "engine_unavailable" }))?.reason).toBe("engine_unavailable");
  });

  it("execution live, no runner → builds will wait, Build Farm", () => {
    const notice = runConsoleNotice(withOff({ buildIntegration: "no_runner" }));

    expect(notice?.sentence).toBe("No runner is online — builds will wait.");
    expect(notice?.fix.label).toBe("Build Farm →");
  });

  it("all live → nothing", () => {
    expect(runConsoleNotice(live())).toBeNull();
  });
});
