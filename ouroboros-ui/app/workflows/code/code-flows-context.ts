"use client";

import { createContext, useContext } from "react";

import type { CodeDiagnostic, WorkflowCodeValidation } from "@/app/api/workflows";

import type { FlowNotice } from "./code-flows";
import type { AnchoredOutline } from "./code-panel";
import type { CodeSaveState } from "./code-save";

/**
 * The code view's Validate and Publish flows, as their readers see them — V.6
 * ([#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * Kept apart from the provider (`code-flows-session.tsx`) for `studio-session-context.ts`' reason: the
 * provider calls the Server Actions, and the head's actions, the notice and the workbench only *read* the
 * flows — so each of them still renders, as its suites render it, with no provider at all.
 */

/** What the flows ask of the file on the page — registered by the workbench while it holds one. */
export interface CodeBench {
  /**
   * Write whatever is waiting, and wait for every write in flight.
   *
   * @returns Where the save stands afterwards — `conflict` too while a kept text waits beside a moved draft.
   */
  readonly flush: () => Promise<CodeSaveState>;
  /**
   * What the page holds now.
   *
   * @returns The file's span map with the text it counts, and the draft's etag as the page last knew it.
   */
  readonly snapshot: () => { readonly outline: AnchoredOutline | null; readonly etag: string | null };
  /**
   * Put the editor's cursor on a stage.
   *
   * @param node The stage's id.
   */
  readonly reveal: (node: string) => void;
}

/** Findings to draw in the editor, with the text they were placed in and the draft they are about. */
export interface CheckedFindings {
  /** The text the ranges count. */
  readonly anchor: string;
  /** The diagnostics. */
  readonly items: readonly CodeDiagnostic[];
  /** The draft's etag they were found under — drawn only while the page still holds that draft. */
  readonly etag: string | null;
}

/** Everything the code view's head, notice and workbench share about the two flows. */
export interface CodeFlowsValue {
  /** Whether a file is on the page to validate and publish. */
  readonly ready: boolean;
  /** The version in force, or `null`. Follows a publish. */
  readonly currentVersion: number | null;
  /** Whether a validation is in flight. */
  readonly validating: boolean;
  /** The last validation's answer, or `null`. */
  readonly validation: WorkflowCodeValidation | null;
  /** The findings the last validation or refused publish drew, or `null`. */
  readonly checked: CheckedFindings | null;
  /** The sentence the last flow left, or `null`. */
  readonly notice: FlowNotice | null;
  /** Run **Validate**. */
  readonly validate: () => void;
  /** Open the publish dialog. */
  readonly openPublish: () => void;
  /** Dismiss the notice. */
  readonly dismissNotice: () => void;
  /**
   * Hand over the file on the page, or `null` when it leaves.
   *
   * @param bench What the flows may ask of it.
   */
  readonly register: (bench: CodeBench | null) => void;
}

/** The context the provider fills. */
export const CodeFlowsContext = createContext<CodeFlowsValue | null>(null);

/**
 * The code view's flows, when the page has them.
 *
 * @returns The flows, or `null` outside `CodeFlows` — a page with no workflow, or a suite rendering one part.
 */
export function useCodeFlows(): CodeFlowsValue | null {
  return useContext(CodeFlowsContext);
}
