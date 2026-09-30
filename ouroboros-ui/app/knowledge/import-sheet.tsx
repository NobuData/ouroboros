"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { RuleImportFile, RuleImportPreview } from "@/app/api/knowledge-import";
import type { Reading } from "@/app/api/reading";
import { useFocusRepo } from "@/app/shell/focus-repo";
import { ShellOverlay } from "@/app/shell/overlay";
import { Button, Chip, EmptyState, SelectField } from "@/app/ui";

import {
  APPLYING,
  APPLY_SUBMIT,
  FACT_SAMPLES_TITLE,
  FILES_CAPTION,
  FILE_COLUMN,
  IMPORT_CANCEL,
  IMPORT_CLOSE,
  IMPORT_NOTE,
  IMPORT_REPO_LABEL,
  IMPORT_TITLE,
  NOTHING_ENABLED,
  NOTHING_USABLE_NOTE,
  PREVIEWING,
  PREVIEW_AGAIN,
  PREVIEW_SUBMIT,
  type PreviewKind,
  SKILL_SAMPLES_TITLE,
  UNCHANGED_NOTE,
  UPDATE_MARK,
  YIELD_COLUMN,
  applyReason,
  defaultRepo,
  fileLine,
  importFailure,
  importReason,
  importToast,
  noneFoundNote,
  previewKind,
  repoRef,
  sectionLine,
  totalsLine,
} from "./import";
import { applyImport, previewImport } from "./import-actions";
import type { KnowledgeToast } from "./toast";
import { IMPORT_LABEL } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's **Import CLAUDE.md / .cursorrules** head action, and the sheet behind it
 * (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)).
 *
 * Two steps in one overlay. The first asks which repository — opening on the header chip's focus
 * repo when it is one of the enabled ones — and **Preview** reads its rules files. The second is
 * the preview: which files were found, what each would create, samples of both kinds, how many
 * candidates dedupe away, and the statement that nothing will be enabled; then **Apply**, which
 * sends the preview's fingerprint back so what is written is exactly what was shown. The three
 * previews that are not imports — no files, unchanged, nothing usable — draw their own sentence in
 * place of the samples and leave **Apply** inert with the reason (`app/knowledge/import.ts`).
 *
 * On a successful apply the sheet closes, the page re-reads, and a toast says what was written and
 * links to the two review states it filled.
 *
 * **Rendered only for an administrator**: the screen does not mount this for anyone else. The
 * button is inert, with the reason, when there is no repository to import from.
 */

/** What the action needs to be told. */
export interface ImportSheetProps {
  /** The enabled repositories, or why they could not be read — the choices. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** The workspace's id — what the focus-repo chip's choice is keyed by. */
  readonly workspaceId: string;
  /** Called with the toast to leave once the apply has written. */
  readonly onImported: (toast: KnowledgeToast) => void;
}

/**
 * The action, and its sheet.
 *
 * @param props See {@link ImportSheetProps}.
 * @returns The ghost button, with the sheet beside it while it is open.
 */
export function ImportSheet({ repos, workspaceId, onImported }: ImportSheetProps) {
  const router = useRouter();
  const fields = useId();
  const focus = useFocusRepo(workspaceId);

  const choices = repos.ok ? repos.value : [];

  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [preview, setPreview] = useState<RuleImportPreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, startWork] = useTransition();

  /** Open on the first step, on the chip's repository. */
  function openSheet(): void {
    setRepo(defaultRepo(choices, focus));
    setPreview(null);
    setFailure(null);
    setOpen(true);
  }

  /** Close without writing. */
  function close(): void {
    setOpen(false);
  }

  /** Back to the first step, keeping the repository. */
  function again(): void {
    setPreview(null);
    setFailure(null);
  }

  /**
   * Read the rules files and show what an apply would write.
   *
   * @param event The submit.
   */
  function submitPreview(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (busy || repo === "") return;

    setFailure(null);

    startWork(async () => {
      const outcome = await previewImport({ repo });

      if (!outcome.ok) {
        setFailure(importFailure(outcome.refusal));
        return;
      }

      setPreview(outcome.value);
    });
  }

  /** Write exactly what the preview showed. */
  function apply(): void {
    if (busy || preview === null) return;

    setFailure(null);

    startWork(async () => {
      const outcome = await applyImport({ repo: preview.repo, fingerprint: preview.fingerprint });

      if (!outcome.ok) {
        setFailure(importFailure(outcome.refusal));
        return;
      }

      setOpen(false);
      onImported(importToast(outcome.value));
      // The skills and facts regions re-read, and list what was just written.
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={openSheet} reason={importReason(repos.ok ? repos.value : null)} tone="ghost">
        {IMPORT_LABEL}
      </Button>

      <ShellOverlay label={IMPORT_TITLE} onClose={close} open={open} wide>
        <h2 className="shell-overlay__title">{IMPORT_TITLE}</h2>
        <p className="shell-overlay__note">{IMPORT_NOTE}</p>

        {preview === null ? (
          <form className="knowledge-import" onSubmit={submitPreview}>
            <SelectField
              id={`${fields}-repo`}
              label={IMPORT_REPO_LABEL}
              name="repo"
              onChange={(event) => { setRepo(event.currentTarget.value); setFailure(null); }}
              value={repo}
            >
              {choices.map((one) => (
                <option key={one.id} value={repoRef(one)}>
                  {repoRef(one)}
                </option>
              ))}
            </SelectField>

            {failure !== null && (
              <p className="knowledge-import__failure" role="alert">
                {failure}
              </p>
            )}

            {busy && (
              <p className="knowledge-import__state" role="status">
                {PREVIEWING}
              </p>
            )}

            <div className="knowledge-import__actions">
              <Button reason={busy ? PREVIEWING : undefined} tone="primary" type="submit">
                {PREVIEW_SUBMIT}
              </Button>
              <Button onClick={close} tone="ghost" type="button">
                {IMPORT_CANCEL}
              </Button>
            </div>
          </form>
        ) : (
          <PreviewStep
            busy={busy}
            failure={failure}
            onAgain={again}
            onApply={apply}
            onClose={close}
            preview={preview}
          />
        )}
      </ShellOverlay>
    </>
  );
}

/**
 * The second step: what an apply would write, or which of the three non-imports this is.
 *
 * @param props.preview The preview.
 * @param props.busy Whether the apply is in flight.
 * @param props.failure The apply's refusal, or `null`.
 * @param props.onApply Write it.
 * @param props.onAgain Back to the repository step.
 * @param props.onClose Leave without writing.
 * @returns The step.
 */
function PreviewStep({
  preview,
  busy,
  failure,
  onApply,
  onAgain,
  onClose,
}: Readonly<{
  preview: RuleImportPreview;
  busy: boolean;
  failure: string | null;
  onApply: () => void;
  onAgain: () => void;
  onClose: () => void;
}>) {
  const kind = previewKind(preview);
  const held = applyReason(kind);

  return (
    <div className="knowledge-import">
      <p className="knowledge-import__repo">{preview.repo}</p>

      <table className="knowledge-import__files">
        <caption className="knowledge-import__caption">{FILES_CAPTION}</caption>
        <thead>
          <tr>
            <th scope="col">{FILE_COLUMN}</th>
            <th scope="col">{YIELD_COLUMN}</th>
          </tr>
        </thead>
        <tbody>
          {preview.files.map((file) => (
            <FileRow file={file} key={file.path} />
          ))}
        </tbody>
      </table>

      {kind === "ready" ? (
        <>
          <p className="knowledge-import__totals">{totalsLine(preview.totals)}</p>
          <Samples preview={preview} />
          <p className="knowledge-import__note">{NOTHING_ENABLED}</p>
        </>
      ) : (
        <EmptyState note={emptyNote(kind, preview.repo)} title={held ?? ""} variant="flush" />
      )}

      {failure !== null && (
        <p className="knowledge-import__failure" role="alert">
          {failure}
        </p>
      )}

      {busy && (
        <p className="knowledge-import__state" role="status">
          {APPLYING}
        </p>
      )}

      <div className="knowledge-import__actions">
        {kind === "ready" && (
          <Button onClick={onApply} reason={busy ? APPLYING : undefined} tone="primary" type="button">
            {APPLY_SUBMIT}
          </Button>
        )}
        <Button onClick={onAgain} tone={kind === "ready" ? "ghost" : "default"} type="button">
          {PREVIEW_AGAIN}
        </Button>
        <Button onClick={onClose} tone="ghost" type="button">
          {kind === "ready" ? IMPORT_CANCEL : IMPORT_CLOSE}
        </Button>
      </div>
    </div>
  );
}

/**
 * The note under a non-import's heading.
 *
 * @param kind Which non-import.
 * @param repo The repository, for the empty result's guidance.
 * @returns The note.
 */
function emptyNote(kind: PreviewKind, repo: string): string {
  switch (kind) {
    case "none-found":
      return noneFoundNote(repo);
    case "unchanged":
      return UNCHANGED_NOTE;
    case "nothing-usable":
      return NOTHING_USABLE_NOTE;
    default:
      return "";
  }
}

/**
 * One probed file: its path in the mono face, and what it would create.
 *
 * @param props.file The file.
 * @returns The row.
 */
function FileRow({ file }: Readonly<{ file: RuleImportFile }>) {
  return (
    <tr className={file.found ? undefined : "knowledge-import__file--absent"}>
      <th className="knowledge-import__path" scope="row">
        {file.path}
      </th>
      <td>{fileLine(file)}</td>
    </tr>
  );
}

/**
 * The samples: up to five skill drafts and five fact candidates, across every found file.
 *
 * @param props.preview The preview.
 * @returns Both lists, each only when it has something to show.
 */
function Samples({ preview }: Readonly<{ preview: RuleImportPreview }>) {
  const found = preview.files.filter((file) => file.found);
  const skills = found.flatMap((file) => file.skills.samples.map((sample) => ({ file, sample })));
  const facts = found.flatMap((file) => file.facts.samples.map((sample) => ({ file, sample })));

  return (
    <div className="knowledge-import__samples">
      {skills.length > 0 && (
        <section className="knowledge-import__kind">
          <h3 className="knowledge-import__kind-title">{SKILL_SAMPLES_TITLE}</h3>
          <ul className="knowledge-import__list">
            {skills.map(({ file, sample }) => (
              <li className="knowledge-import__sample" key={`${file.path}:${sample.slug}`}>
                <span className="knowledge-import__sample-head">
                  <span className="knowledge-import__slug">{sample.slug}</span>
                  <span className="knowledge-import__name">{sample.name}</span>
                  {sample.action === "update" && <Chip tone="warn">{UPDATE_MARK}</Chip>}
                </span>
                <span className="knowledge-import__desc">{sample.description}</span>
                <span className="knowledge-import__src">{sectionLine(sample.section, file.path)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {facts.length > 0 && (
        <section className="knowledge-import__kind">
          <h3 className="knowledge-import__kind-title">{FACT_SAMPLES_TITLE}</h3>
          <ul className="knowledge-import__list">
            {facts.map(({ file, sample }) => (
              <li className="knowledge-import__sample" key={`${file.path}:${sample.text}`}>
                <span className="knowledge-import__fact">{sample.text}</span>
                <span className="knowledge-import__src">{sectionLine(sample.section, file.path)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
