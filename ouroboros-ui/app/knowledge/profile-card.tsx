"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { EnabledRepo } from "@/app/api/enablement";
import type { EnvRecipe } from "@/app/api/env-recipes";
import type { Reading } from "@/app/api/reading";
import { KNOWLEDGE_PATH } from "@/app/paths";
import { Button, Card, CardHead, Chip, EmptyState, SelectField, Tag, TextAreaField, cx } from "@/app/ui";

import { repoRef } from "./create";
import { KnowledgeUnread } from "./knowledge-unread";
import {
  DETECTION_EDIT,
  DETECTION_EDIT_REASON,
  ENV_ADD,
  ENV_ADMIN_REASON,
  ENV_CANCEL,
  ENV_CONSUMERS_NOTE,
  ENV_EDIT,
  ENV_EYEBROW,
  ENV_SAVING,
  ENV_TEXT_HINT,
  ENV_TEXT_LABEL,
  NOT_SCANNED_NOTE,
  NOT_SCANNED_TITLE,
  NO_PROTECTED_PATHS,
  NO_RECIPE_NOTE,
  NO_RECIPE_TITLE,
  NO_REPOS_NOTE,
  NO_REPOS_TITLE,
  PROFILE_UNREAD_TITLE,
  PROTECTED_EDIT,
  PROTECTED_EDIT_REASON,
  PROTECTED_PATHS_LABEL,
  RECIPE_UNREAD_TITLE,
  REPOS_UNREAD_TITLE,
  REPO_PARAM,
  REPO_SELECT_LABEL,
  SNAPSHOT_DETAIL,
  SNAPSHOT_HONEST,
  SNAPSHOT_LABEL,
  parseRecipeText,
  profileChip,
  profileRows,
  profileTitle,
  protectedPathNote,
  recipeText,
  saveFailure,
  saveLabel,
  savedToast,
  versionLine,
} from "./profile";
import { saveEnvRecipe } from "./profile-actions";
import type { KnowledgeToast } from "./toast";
import { PROFILE_REGION_ID, type ProfileReadings } from "./view";

import "./knowledge.css";

/**
 * Mockup 14's *Repo Profile* card (BG.4, [#420](https://github.com/NobuData/ouroboros/issues/420)):
 * the `detected` pill, the profile rows composed from detection and the protected paths, the
 * **Environment** block, and the warm-snapshot row.
 *
 * The decisions are `app/knowledge/profile.ts`'s; what is here is state and wiring:
 *
 * - **The repository is the address's.** With more than one enabled, a select in the head moves
 *   the address to `?repo=owner/name` and the page re-reads for it — a link to a repository's
 *   profile is then a link.
 * - **The rows edit nothing.** Each edit affordance is inert with the reason naming the surface
 *   that owns the data, because those surfaces are not built and a local editor would be a
 *   second copy of the truth.
 * - **The Environment block edits in place.** An administrator's **Edit** opens the block as
 *   text; **Save as v4** parses it, refuses a bad line before a round trip, and makes one `PUT`.
 *   The block takes the version the service answered, a live region says so, the toast is the
 *   page's, and the page re-reads behind it. A conflict re-reads too.
 * - **The snapshot row is honest**: one row, no number, until #426 measures one.
 * - **Its states are designed** (#422): a repository with no recipe holds **Add environment
 *   recipe** in the empty state itself; unread repositories, detection or recipe each say what
 *   could not be read, why, and offer the re-read (`knowledge-unread.tsx`) — and unread
 *   repositories are no longer drawn as *none enabled*.
 */

/** What the card is told. */
export interface ProfileCardProps {
  /** What the card composes, for the repository it draws. */
  readonly profile: ProfileReadings;
  /** The enabled repositories, or why not — the head's select. */
  readonly repos: Reading<readonly EnabledRepo[]>;
  /** The instant the page was read, ISO 8601 — what the version line's age is measured from. */
  readonly readAt: string;
  /** Whether this reader is an `owner` or an `admin` — who may edit the recipe. */
  readonly mayAdminister: boolean;
  /** Called with the toast a save leaves. */
  readonly onToast: (toast: KnowledgeToast) => void;
}

/**
 * The card.
 *
 * @param props See {@link ProfileCardProps}.
 * @returns The card.
 */
export function ProfileCard({ profile, repos, readAt, mayAdminister, onToast }: ProfileCardProps) {
  const router = useRouter();
  const ids = useId();
  const now = new Date(readAt);
  const chip = profileChip(profile.detection);
  const choices = repos.ok ? repos.value : [];

  return (
    <Card aria-labelledby={`${PROFILE_REGION_ID}-title`} as="section">
      <CardHead
        beside={profile.repo !== null && <Chip dot={chip.dot} tone={chip.tone}>{chip.text}</Chip>}
        className="knowledge-profile__head"
        title={profileTitle(profile.repo)}
        titleId={`${PROFILE_REGION_ID}-title`}
        trailing={
          choices.length > 1 && profile.repo !== null ? (
            <SelectField
              className="knowledge-profile__select"
              id={`${ids}-repo`}
              label={REPO_SELECT_LABEL}
              name={REPO_PARAM}
              onChange={(event) => {
                router.replace(`${KNOWLEDGE_PATH}?${REPO_PARAM}=${encodeURIComponent(event.currentTarget.value)}`);
              }}
              value={repoRef(profile.repo)}
            >
              {choices.map((repo) => (
                <option key={repo.id} value={repoRef(repo)}>
                  {repoRef(repo)}
                </option>
              ))}
            </SelectField>
          ) : undefined
        }
      />

      {!repos.ok ? (
        <KnowledgeUnread reason={repos.reason} title={REPOS_UNREAD_TITLE} />
      ) : profile.repo === null ? (
        <EmptyState note={NO_REPOS_NOTE} title={NO_REPOS_TITLE} variant="flush" />
      ) : (
        <>
          <DetectionRows detection={profile.detection} ids={ids} />
          <Environment
            ids={ids}
            mayAdminister={mayAdminister}
            now={now}
            onToast={onToast}
            recipe={profile.recipe}
            repo={repoRef(profile.repo)}
          />
          <div className="knowledge-profile__snapshot">
            <span aria-hidden="true" className="knowledge-profile__snapshot-dot" />
            <p className="knowledge-profile__snapshot-text" title={SNAPSHOT_DETAIL}>
              <span className="knowledge-profile__snapshot-label">{SNAPSHOT_LABEL}</span> — {SNAPSHOT_HONEST}
              <span className="sr-only"> {SNAPSHOT_DETAIL}</span>
            </p>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The profile rows and the protected paths, from detection.
 *
 * @param props.detection The detection reading.
 * @param props.ids The card's id prefix.
 * @returns The rows, or why there are none.
 */
function DetectionRows({ detection, ids }: Readonly<{ detection: ProfileReadings["detection"]; ids: string }>) {
  if (!detection.ok) return <KnowledgeUnread reason={detection.reason} title={PROFILE_UNREAD_TITLE} />;

  const rows = detection.value.scan === null ? null : profileRows(detection.value);
  const paths = detection.value.protectedPaths;
  const editId = `${ids}-detection-edit`;
  const pathsEditId = `${ids}-paths-edit`;

  return (
    <>
    <dl className="knowledge-profile__rows">
      {rows === null ? (
        <div className="knowledge-profile__row">
          <dt className="knowledge-profile__key">{NOT_SCANNED_TITLE}</dt>
          <dd className="knowledge-profile__value knowledge-profile__value--absent">{NOT_SCANNED_NOTE}</dd>
        </div>
      ) : (
        rows.map((row) => (
          <div className="knowledge-profile__row" key={row.key}>
            <dt className="knowledge-profile__key">{row.label}</dt>
            <dd
              className={cx(
                "knowledge-profile__value",
                row.tone === "warn" && "knowledge-profile__value--warn",
                row.tone === "missing" && "knowledge-profile__value--missing",
                row.tone === "absent" && "knowledge-profile__value--absent",
              )}
            >
              <span>{row.value}</span>
              {row.labelled !== null && <span className="knowledge-profile__labelled">{row.labelled}</span>}
              <Button
                aria-describedby={editId}
                aria-label={`${DETECTION_EDIT}: ${row.label}`}
                className="knowledge-profile__edit"
                reason={DETECTION_EDIT_REASON}
                size="sm"
                tone="ghost"
              >
                {DETECTION_EDIT}
              </Button>
            </dd>
          </div>
        ))
      )}
      <div className="knowledge-profile__row">
        <dt className="knowledge-profile__key">{PROTECTED_PATHS_LABEL}</dt>
        <dd className="knowledge-profile__value">
          {paths.length === 0 ? (
            <span className="knowledge-profile__value--absent">{NO_PROTECTED_PATHS}</span>
          ) : (
            paths.map((path) => (
              <Tag key={path.glob} title={protectedPathNote(path.source)}>
                {path.glob}
              </Tag>
            ))
          )}
          <Button
            aria-describedby={pathsEditId}
            aria-label={`${PROTECTED_EDIT}: ${PROTECTED_PATHS_LABEL}`}
            className="knowledge-profile__edit"
            reason={PROTECTED_EDIT_REASON}
            size="sm"
            tone="ghost"
          >
            {PROTECTED_EDIT}
          </Button>
        </dd>
      </div>
    </dl>
    {/* The reasons are in the tree once each, for every inert affordance to be described by. */}
    <p className="sr-only" id={editId}>
      {DETECTION_EDIT_REASON}
    </p>
    <p className="sr-only" id={pathsEditId}>
      {PROTECTED_EDIT_REASON}
    </p>
    </>
  );
}

/**
 * The Environment block: the recipe in force, its version line, and the in-place editor.
 *
 * @param props.recipe The recipe reading.
 * @param props.repo The repository, `owner/name`.
 * @param props.now The instant the page was read.
 * @param props.ids The card's id prefix.
 * @param props.mayAdminister Whether the reader may edit.
 * @param props.onToast Called with the toast a save leaves.
 * @returns The block.
 */
function Environment({
  recipe,
  repo,
  now,
  ids,
  mayAdminister,
  onToast,
}: Readonly<{
  recipe: ProfileReadings["recipe"];
  repo: string;
  now: Date;
  ids: string;
  mayAdminister: boolean;
  onToast: (toast: KnowledgeToast) => void;
}>) {
  const router = useRouter();

  const [saved, setSaved] = useState<EnvRecipe | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [announced, setAnnounced] = useState("");
  const [saving, startSaving] = useTransition();

  const current = saved ?? (recipe.ok ? recipe.value : null);
  const editReason = mayAdminister ? undefined : ENV_ADMIN_REASON;

  /** Open the editor on the block as it stands. */
  function edit(): void {
    setText(recipeText(current));
    setProblem(null);
    setFailure(null);
    setEditing(true);
  }

  /**
   * Parse and send.
   *
   * @param event The submit.
   */
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (saving) return;

    const parsed = parseRecipeText(text);
    if (!parsed.ok) {
      setProblem(parsed.problem);
      return;
    }

    setProblem(null);
    setFailure(null);

    startSaving(async () => {
      const outcome = await saveEnvRecipe({ repo, commands: [...parsed.commands] });

      if (!outcome.ok) {
        setFailure(saveFailure(outcome.refusal));
        if (outcome.refusal.code === "env_recipe_version_conflict") router.refresh();
        return;
      }

      setSaved(outcome.value);
      setEditing(false);
      setAnnounced(`Saved as v${String(outcome.value.version)}.`);
      onToast(savedToast(outcome.value));
      router.refresh();
    });
  }

  return (
    <section aria-labelledby={`${ids}-env`} className="knowledge-profile__env">
      <div className="knowledge-profile__env-head">
        <h3 className="knowledge-profile__env-eyebrow" id={`${ids}-env`}>
          {ENV_EYEBROW}
        </h3>
        {current !== null && <span className="knowledge-profile__env-version">{versionLine(current, now)}</span>}
        {/* With no recipe the add is the empty state's own action (#422), below. */}
        {!editing && recipe.ok && current !== null && (
          <Button className="knowledge-profile__env-action" onClick={edit} reason={editReason} size="sm" tone="ghost">
            {ENV_EDIT}
          </Button>
        )}
      </div>

      {!recipe.ok ? (
        <KnowledgeUnread reason={recipe.reason} title={RECIPE_UNREAD_TITLE} />
      ) : editing ? (
        <form className="knowledge-profile__editor" onSubmit={submit}>
          <TextAreaField
            autoFocus
            error={problem ?? undefined}
            hint={ENV_TEXT_HINT}
            id={`${ids}-env-text`}
            label={ENV_TEXT_LABEL}
            mono
            name="commands"
            onChange={(event) => { setText(event.currentTarget.value); setProblem(null); }}
            rows={Math.max(4, text.split("\n").length + 1)}
            spellCheck={false}
            value={text}
          />
          {failure !== null && (
            <p className="knowledge-profile__refusal" role="alert">
              {failure}
            </p>
          )}
          <div className="knowledge-profile__editor-actions">
            <Button reason={saving ? ENV_SAVING : undefined} size="sm" tone="primary" type="submit">
              {saving ? ENV_SAVING : saveLabel(current)}
            </Button>
            <Button onClick={() => { setEditing(false); }} size="sm" tone="ghost" type="button">
              {ENV_CANCEL}
            </Button>
          </div>
        </form>
      ) : current === null ? (
        <EmptyState note={NO_RECIPE_NOTE} title={NO_RECIPE_TITLE} variant="flush">
          <div className="knowledge-empty__actions">
            <Button onClick={edit} reason={editReason} size="sm">
              {ENV_ADD}
            </Button>
          </div>
        </EmptyState>
      ) : (
        <pre className="knowledge-profile__code">
          {current.commands.map((command, index) => (
            <span className="knowledge-profile__code-line" key={index}>
              {command.command}
              {command.comment !== null && (
                <span className="knowledge-profile__code-comment"> # {command.comment}</span>
              )}
              {"\n"}
            </span>
          ))}
        </pre>
      )}

      {recipe.ok && <p className="knowledge-profile__consumers">{ENV_CONSUMERS_NOTE}</p>}
      <p aria-live="polite" className="sr-only">
        {announced}
      </p>
    </section>
  );
}
