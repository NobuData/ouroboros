"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button, Tag, TextField } from "@/app/ui";

import {
  GLOB_PROBLEMS,
  type GlobPreview,
  type GlobPreviewRepository,
  type GlobProblem,
  PREVIEW_LOADING,
  PREVIEW_NO_GLOBS,
  PREVIEW_NO_REPOSITORIES,
  globProblem,
  matchLine,
  repositoryLine,
} from "./glob";

import "./globs.css";

/**
 * The shared glob editor (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)) — a
 * list of path patterns, edited one validated pattern at a time, with a preview of what each
 * one actually matches.
 *
 * It is shared by construction rather than by copy: the policy card's `protected_paths` rule
 * and the Get Started detection card's protected-paths row (BC.2,
 * [#391](https://github.com/NobuData/ouroboros/issues/391)) both mount it — one grammar, one
 * editor, one preview. It names no domain concept: it takes a list, says when the list changes, and is
 * handed the function that fetches a preview.
 *
 * ### An invalid pattern never joins the list
 *
 * Every text that would enter the list — a new pattern, or an edit of one — is checked with
 * `globProblem` first. One that fails stays in its input, with the reason under it, and
 * `onChange` is not called: the list a parent holds is always one the service's validator
 * accepts, so there is nothing to reject on save.
 *
 * ### The preview is the service's answer
 *
 * `preview` is called with the list as it stands — plus the pattern being typed, once it is
 * valid, marked *not added yet* — when the editor mounts and, after {@link PREVIEW_DEBOUNCE_MS}
 * of quiet, whenever that list changes. An answer for a list that has since changed is dropped.
 * A pattern that matches no file in any repository checked is said to in words: it is the result
 * a reader most needs to notice, and it protects nothing.
 *
 * @param props See {@link GlobEditorProps}.
 * @returns The editor.
 */
export function GlobEditor({
  id,
  label,
  globs,
  onChange,
  readOnly = false,
  preview,
}: GlobEditorProps) {
  const [adding, setAdding] = useState("");
  const [addProblem, setAddProblem] = useState<GlobProblem | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  /** The pattern being typed, once it could join the list. */
  const candidate = !readOnly && globProblem(adding, globs) === null ? adding : null;
  const shown = usePreview(candidate === null ? globs : [...globs, candidate], preview);

  /** Add the typed pattern, or say why it cannot be added. */
  function add(): void {
    const problem = globProblem(adding, globs);
    setAddProblem(problem);
    if (problem !== null) return;

    onChange([...globs, adding]);
    setAdding("");
  }

  /** Save the pattern being edited, or say why it cannot be saved. */
  function saveEdit(): void {
    if (editing === null) return;

    const others = globs.filter((_, index) => index !== editing.index);
    // Capacity is a rule about adding; an edit replaces one pattern with one.
    const found = editing.text === globs[editing.index] ? null : globProblem(editing.text, others);
    const problem = found === "full" ? null : found;

    if (problem !== null) {
      setEditing({ ...editing, problem });
      return;
    }

    if (editing.text !== globs[editing.index]) {
      onChange(globs.map((glob, index) => (index === editing.index ? editing.text : glob)));
    }
    setEditing(null);
  }

  /**
   * Remove one pattern.
   *
   * @param index Its place in the list.
   */
  function remove(index: number): void {
    setEditing(null);
    onChange(globs.filter((_, at) => at !== index));
  }

  return (
    <div className="glob-editor">
      <ul aria-label={label} className="glob-editor__list">
        {globs.map((glob, index) =>
          editing?.index === index && !readOnly ? (
            <li className="glob-editor__item glob-editor__item--editing" key={glob}>
              <TextField
                autoComplete="off"
                className="glob-editor__field"
                error={editing.problem === null ? undefined : GLOB_PROBLEMS[editing.problem]}
                id={`${id}-edit`}
                label={`Pattern ${glob}`}
                mono
                onChange={(event) => {
                  setEditing({ index, text: event.target.value, problem: null });
                }}
                onKeyDown={(event) => {
                  onKey(event, saveEdit, () => {
                    setEditing(null);
                  });
                }}
                spellCheck={false}
                value={editing.text}
              />
              <span className="glob-editor__actions">
                <Button onClick={saveEdit} size="sm">
                  {SAVE_LABEL}
                </Button>
                <Button
                  onClick={() => {
                    setEditing(null);
                  }}
                  size="sm"
                  tone="ghost"
                >
                  {CANCEL_LABEL}
                </Button>
              </span>
            </li>
          ) : (
            <li className="glob-editor__item" key={glob}>
              <span className="glob-editor__glob">{glob}</span>
              {!readOnly && (
                <span className="glob-editor__actions">
                  <Button
                    aria-label={`Edit ${glob}`}
                    onClick={() => {
                      setEditing({ index, text: glob, problem: null });
                    }}
                    size="sm"
                    tone="ghost"
                  >
                    {EDIT_LABEL}
                  </Button>
                  <Button
                    aria-label={`Remove ${glob}`}
                    onClick={() => {
                      remove(index);
                    }}
                    size="sm"
                    tone="ghost"
                  >
                    {REMOVE_LABEL}
                  </Button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>

      {!readOnly && (
        <div className="glob-editor__add">
          <TextField
            autoComplete="off"
            className="glob-editor__field"
            error={addProblem === null ? undefined : GLOB_PROBLEMS[addProblem]}
            hint={ADD_HINT}
            id={`${id}-add`}
            label={ADD_LABEL}
            mono
            onChange={(event) => {
              setAdding(event.target.value);
              setAddProblem(null);
            }}
            onKeyDown={(event) => {
              onKey(event, add);
            }}
            spellCheck={false}
            value={adding}
          />
          <Button onClick={add}>{ADD_BUTTON}</Button>
        </div>
      )}

      <PreviewPanel candidate={candidate} shown={shown} />
    </div>
  );
}

/** What the editor takes. */
export interface GlobEditorProps {
  /** The base id; the add input's id is `${id}-add`. */
  readonly id: string;
  /** The list's accessible name — "Protected path patterns". */
  readonly label: string;
  /** The patterns, in order. */
  readonly globs: readonly string[];
  /** Called with the new list — only ever one every pattern of which passes `globProblem`. */
  readonly onChange: (globs: readonly string[]) => void;
  /** Whether the editor is inert for now (a save is in flight): the list is shown, nothing changes it. */
  readonly readOnly?: boolean;
  /** Fetch the match preview for a list — a Server Action in the application. */
  readonly preview: (globs: readonly string[]) => Promise<GlobPreview>;
}

/** How long the list must be quiet before its preview is fetched, in milliseconds. */
export const PREVIEW_DEBOUNCE_MS = 300;

/** The add row's label, hint and button. */
export const ADD_LABEL = "Add a path pattern";
export const ADD_HINT = "Relative to the repository root — drivers/can/** covers everything under drivers/can.";
export const ADD_BUTTON = "Add";

/** A row's buttons. */
export const EDIT_LABEL = "Edit";
export const REMOVE_LABEL = "Remove";
export const SAVE_LABEL = "Save";
export const CANCEL_LABEL = "Cancel";

/** The marker on a pattern that is previewed while still being typed. */
export const NOT_ADDED = "not added yet";

/** The preview region's accessible name. */
export const PREVIEW_LABEL = "Match preview";

/** What the preview says when the fetch itself failed with nothing to say. */
export const PREVIEW_FAILED = "The match preview could not be fetched. Try again.";

/**
 * What a pattern that matches nothing anywhere is told.
 *
 * @param glob The pattern.
 * @returns The sentence.
 */
export function matchesNothing(glob: string): string {
  return `${glob} matches no file in any repository checked — it protects nothing yet.`;
}

/** A pattern being edited in place. */
interface Editing {
  /** Its place in the list. */
  readonly index: number;
  /** The input's text. */
  readonly text: string;
  /** What the last attempt to save found wrong with it. */
  readonly problem: GlobProblem | null;
}

/** What the preview panel draws. */
type Shown =
  /** The list is empty: nothing was asked. */
  | { readonly kind: "none" }
  /** An answer for the list as it stands is on its way. */
  | { readonly kind: "loading" }
  /** The answer for the list as it stands. */
  | { readonly kind: "answer"; readonly preview: GlobPreview };

/**
 * Run a key's action from an input that is not in a form of its own.
 *
 * The editor may sit inside a card's form, so its inputs act on Enter themselves rather than
 * submitting whatever is around them.
 *
 * @param event The key press.
 * @param enter What Enter does.
 * @param escape What Escape does, when it does anything.
 */
function onKey(event: KeyboardEvent<HTMLInputElement>, enter: () => void, escape?: () => void): void {
  if (event.key === "Enter") {
    event.preventDefault();
    enter();
  } else if (event.key === "Escape" && escape !== undefined) {
    event.preventDefault();
    escape();
  }
}

/**
 * The match preview for a list, kept current.
 *
 * Fetched at once on mount and after {@link PREVIEW_DEBOUNCE_MS} of quiet on every later
 * change. Each fetch is for one list; its answer is kept with that list's key, so an answer
 * that arrives after the list has moved on is never drawn, and nothing is fetched for an empty
 * list. The timer is cleared when the list changes and when the editor unmounts.
 *
 * @param globs The list to preview.
 * @param preview The fetch.
 * @returns What to draw.
 */
function usePreview(
  globs: readonly string[],
  preview: (globs: readonly string[]) => Promise<GlobPreview>,
): Shown {
  const key = JSON.stringify(globs);
  const [answer, setAnswer] = useState<{ readonly key: string; readonly preview: GlobPreview } | null>(
    null,
  );
  /** The fetch as of the latest render, so a new function identity alone refetches nothing. */
  const fetcher = useRef(preview);
  /** Whether the next fetch is the mount's, which does not wait. */
  const first = useRef(true);

  useEffect(() => {
    fetcher.current = preview;
  });

  useEffect(() => {
    const list = JSON.parse(key) as readonly string[];
    const delay = first.current ? 0 : PREVIEW_DEBOUNCE_MS;
    first.current = false;

    if (list.length === 0) return;

    let current = true;
    const timer = setTimeout(() => {
      fetcher.current(list).then(
        (result) => {
          if (current) setAnswer({ key, preview: result });
        },
        () => {
          if (current) setAnswer({ key, preview: { ok: false, reason: PREVIEW_FAILED } });
        },
      );
    }, delay);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key]);

  if (globs.length === 0) return { kind: "none" };

  return answer?.key === key ? { kind: "answer", preview: answer.preview } : { kind: "loading" };
}

/**
 * The patterns of an answer that match no file in any repository that could be listed.
 *
 * @param repositories The answer's repositories.
 * @returns The patterns, in the answer's order — empty when no repository was listed, since
 *   nothing was checked.
 */
function unmatched(repositories: readonly GlobPreviewRepository[]): readonly string[] {
  const listed = repositories.filter((repository) => repository.status === "listed");
  const totals = new Map<string, number>();

  for (const repository of listed) {
    for (const { glob, matchCount } of repository.globs) {
      totals.set(glob, (totals.get(glob) ?? 0) + matchCount);
    }
  }

  return [...totals].filter(([, total]) => total === 0).map(([glob]) => glob);
}

/**
 * The preview: a live region that says what the patterns match.
 *
 * @param props.shown What to draw.
 * @param props.candidate The pattern previewed while still being typed, or `null`.
 * @returns The region.
 */
function PreviewPanel({
  shown,
  candidate,
}: Readonly<{ shown: Shown; candidate: string | null }>) {
  return (
    <div aria-label={PREVIEW_LABEL} className="glob-editor__preview" role="status">
      {shown.kind === "none" ? (
        <p className="glob-editor__note">{PREVIEW_NO_GLOBS}</p>
      ) : shown.kind === "loading" ? (
        <p className="glob-editor__note">{PREVIEW_LOADING}</p>
      ) : !shown.preview.ok ? (
        <p className="glob-editor__note">{shown.preview.reason}</p>
      ) : shown.preview.repositories.length === 0 ? (
        <p className="glob-editor__note">{PREVIEW_NO_REPOSITORIES}</p>
      ) : (
        <>
          {shown.preview.repositories.map((repository) => (
            <RepositoryMatches
              candidate={candidate}
              key={repository.repository}
              repository={repository}
            />
          ))}
          {unmatched(shown.preview.repositories).map((glob) => (
            <p className="glob-editor__flag" key={glob}>
              {matchesNothing(glob)}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

/**
 * One repository's part of the preview.
 *
 * @param props.repository The repository's answer.
 * @param props.candidate The pattern previewed while still being typed, or `null`.
 * @returns Its heading and, when its tree was listed, each pattern's matches.
 */
function RepositoryMatches({
  repository,
  candidate,
}: Readonly<{ repository: GlobPreviewRepository; candidate: string | null }>) {
  return (
    <div className="glob-editor__repo">
      <p className="glob-editor__repo-line">{repositoryLine(repository)}</p>
      {repository.status === "listed" && (
        <ul className="glob-editor__matches">
          {repository.globs.map(({ glob, matchCount, samples }) => (
            <li className="glob-editor__match" key={glob}>
              <span className="glob-editor__match-line">
                <span className="glob-editor__glob">{glob}</span>{" "}
                {glob === candidate && <Tag>{NOT_ADDED}</Tag>}{" "}
                <span className="glob-editor__count">{matchLine(matchCount)}</span>
              </span>
              {samples.length > 0 && (
                <ul className="glob-editor__samples">
                  {samples.slice(0, SAMPLES_SHOWN).map((path) => (
                    <li className="glob-editor__sample" key={path}>
                      {path}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The most sample paths drawn under one pattern. */
const SAMPLES_SHOWN = 5;
