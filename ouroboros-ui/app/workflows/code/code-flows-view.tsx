"use client";

import type { WorkflowRailEntry } from "@/app/api/workflows";
import { Button, cx } from "@/app/ui";

import { DISMISS_TOAST_LABEL } from "../publish";
import { publishLabel } from "../view";
import { PUBLISH_NEEDS_FILE, VALIDATE_NEEDS_FILE, VALIDATING } from "./code-flows";
import { useCodeFlows } from "./code-flows-context";
import { VALIDATE_LABEL } from "./code-view";

import "../workflows.css";
import "./code-flows.css";

/**
 * Mockup 05's two head actions — V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * - **Validate** (ghost) runs the shared checks for every member, because it publishes nothing.
 * - **Publish vN+1** (primary) opens S.6's shared dialog, for a role that may publish and nobody else, and
 *   counts from the version in force — the flows', so it moves the moment a publish takes.
 *
 * Without a file on the page — a refused read, a draft with no spelling as code — both are inert and say why:
 * each acts on the file.
 *
 * @param props.entry The selected workflow's rail entry, or `null` when nothing is selected.
 * @param props.mayAdminister Whether the reader may publish.
 * @returns The actions.
 */
export function CodeHeadActions({
  entry,
  mayAdminister,
}: Readonly<{ entry: WorkflowRailEntry | null; mayAdminister: boolean }>) {
  const flows = useCodeFlows();
  const ready = flows !== null && flows.ready;

  return (
    <>
      <Button
        onClick={ready ? flows.validate : undefined}
        reason={!ready ? VALIDATE_NEEDS_FILE : flows.validating ? VALIDATING : undefined}
        tone="ghost"
      >
        {VALIDATE_LABEL}
      </Button>
      {mayAdminister && entry !== null && (
        <Button
          onClick={ready ? flows.openPublish : undefined}
          reason={ready ? undefined : PUBLISH_NEEDS_FILE}
          tone="primary"
        >
          {publishLabel(flows === null ? entry.currentVersion : flows.currentVersion)}
        </Button>
      )}
    </>
  );
}

/**
 * The sentence the last flow left, above the workbench — the studio toast's treatment, on the error tint for a
 * stop. It stays until dismissed, for `studio-toast.tsx`'s reason.
 *
 * @returns The notice while there is one; nothing otherwise, and nothing outside the flows.
 */
export function CodeFlowsNotice() {
  const flows = useCodeFlows();
  if (flows === null || flows.notice === null) return null;

  const { tone, text } = flows.notice;

  return (
    <div
      className={cx("studio-toast", tone === "err" && "code-flows__notice--err")}
      role={tone === "err" ? "alert" : "status"}
    >
      <span className="studio-toast__text">{text}</span>
      <Button aria-label={DISMISS_TOAST_LABEL} onClick={flows.dismissNotice} size="sm" tone="ghost">
        ×
      </Button>
    </div>
  );
}
