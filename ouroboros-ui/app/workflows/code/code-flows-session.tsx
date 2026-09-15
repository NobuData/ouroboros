"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";

import type { WorkflowCodeValidation, WorkflowDefinition, WorkflowRailEntry } from "@/app/api/workflows";

import { publishWorkflow } from "../draft-actions";
import { type PublishFailure, changeNoteBody, publishFailure, publishedToast } from "../publish";
import { PublishDialog } from "../publish-dialog";
import { publishLabel } from "../view";
import { validateCode } from "./code-actions";
import {
  type FlowNotice,
  PUBLISH_NEEDS_FILE,
  latestVersion,
  unpublishable,
  unvalidatable,
  validateRefusal,
  validationNotice,
} from "./code-flows";
import { type CheckedFindings, type CodeBench, CodeFlowsContext, type CodeFlowsValue } from "./code-flows-context";
import { findingDiagnostics, outlineDefinition } from "./code-findings";

/** What the provider takes. */
export interface CodeFlowsProps {
  /** The workflow the page is open on — its id publishes, its slug validates, its version counts. */
  readonly entry: WorkflowRailEntry;
  /** The page. */
  readonly children: ReactNode;
}

/**
 * The code view's **Validate** and **Publish** — V.6 ([#174](https://github.com/NobuData/ouroboros/issues/174)).
 *
 * The page head and the workbench are far apart in the tree and share one set of facts: the file on the
 * page, the version in force, the last validation, and the findings drawn in the editor. This provider holds
 * them (`code-flows-context.ts` is what its readers import) and renders nothing of its own but the dialog.
 * The decisions are `code-flows.ts`'.
 *
 * - **Validate** flushes the workbench's save, then calls `validateCode`. The answer's file diagnostics are
 *   drawn in the editor and its rows replace Loop Checks. Nothing is published, and nothing that could
 *   publish is called.
 * - **Publish** opens S.6's `PublishDialog`. Its submit flushes the save, then calls the canvas's own
 *   `publishWorkflow`. A refusal's findings are listed in the dialog, each selecting its stage in the file,
 *   and drawn in the editor. A success moves the version, leaves the notice and refreshes the route — the
 *   visual editor reads the same workflow, so its head shows the new version too.
 *
 * @param props See {@link CodeFlowsProps}.
 * @returns The page, with the flows around it and the dialog beside it.
 */
export function CodeFlows({ entry, children }: CodeFlowsProps) {
  const router = useRouter();
  const bench = useRef<CodeBench | null>(null);

  const [ready, setReady] = useState(false);
  const [published, setPublished] = useState<number | null>(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<WorkflowCodeValidation | null>(null);
  const [checked, setChecked] = useState<CheckedFindings | null>(null);
  const [notice, setNotice] = useState<FlowNotice | null>(null);
  // The dialog's definition while it is open: the file's stage ids, for anchoring findings.
  const [dialog, setDialog] = useState<WorkflowDefinition | null>(null);

  const currentVersion = latestVersion(entry.currentVersion, published);

  const register = useCallback((next: CodeBench | null) => {
    bench.current = next;
    setReady(next !== null);
  }, []);

  const validate = useCallback(async () => {
    const file = bench.current;
    if (file === null) return;

    setValidating(true);
    setNotice(null);
    try {
      const stopped = unvalidatable(await file.flush());
      if (stopped !== null) {
        setNotice({ tone: "err", text: stopped });
        return;
      }

      const outcome = await validateCode(entry.slug);
      if (!outcome.ok) {
        setNotice({ tone: "err", text: validateRefusal(outcome.refusal) });
        return;
      }

      const { file: validated } = outcome.value;
      setValidation(outcome.value);
      setChecked({ anchor: validated.text, items: validated.diagnostics, etag: validated.etag });
      setNotice(validationNotice(outcome.value));
    } finally {
      setValidating(false);
    }
  }, [entry.slug]);

  const publish = useCallback(
    async (note: string): Promise<PublishFailure | null> => {
      const file = bench.current;
      if (file === null) return { message: PUBLISH_NEEDS_FILE, findings: [] };

      const stopped = unpublishable(await file.flush());
      if (stopped !== null) return { message: stopped, findings: [] };

      const outcome = await publishWorkflow(entry.id, changeNoteBody(note));
      if (!outcome.ok) {
        const failure = publishFailure(outcome.refusal);
        const { outline, etag } = file.snapshot();

        if (failure.findings.length > 0 && outline !== null) {
          // Anchored in the file as it is now: a write the flush made may have moved its lines.
          setDialog(outlineDefinition(outline));
          setChecked({ ...findingDiagnostics(failure.findings, outline), etag });
        }
        return failure;
      }

      setPublished(outcome.value.version);
      setNotice({ tone: "ok", text: publishedToast(outcome.value.version) });
      setDialog(null);
      // The rail's version and the file's etag moved; the visual editor reads the same rows.
      router.refresh();
      return null;
    },
    [entry.id, router],
  );

  const openPublish = useCallback(() => {
    setDialog(outlineDefinition(bench.current?.snapshot().outline ?? null));
  }, []);

  const selectStage = useCallback((node: string) => {
    setDialog(null);
    bench.current?.reveal(node);
  }, []);

  const value = useMemo<CodeFlowsValue>(
    () => ({
      ready,
      currentVersion,
      validating,
      validation,
      checked,
      notice,
      validate: () => void validate(),
      openPublish,
      dismissNotice: () => setNotice(null),
      register,
    }),
    [ready, currentVersion, validating, validation, checked, notice, validate, openPublish, register],
  );

  return (
    <CodeFlowsContext.Provider value={value}>
      {children}

      {dialog !== null && (
        <PublishDialog
          definition={dialog}
          label={publishLabel(currentVersion)}
          onClose={() => setDialog(null)}
          onPublish={publish}
          onSelect={selectStage}
        />
      )}
    </CodeFlowsContext.Provider>
  );
}
