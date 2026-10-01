"use client";

import { useState } from "react";

import type { Role } from "@/app/api/membership";
import type { SkillScope } from "@/app/api/skills";
import { useFocusRepo } from "@/app/shell/focus-repo";
import { Button, Eyebrow } from "@/app/ui";

import { FactsCard } from "./facts-card";
import { ImportSheet } from "./import-sheet";
import { KnowledgeToastSeat } from "./knowledge-toast";
import { NewSkill } from "./new-skill";
import { PlaybooksCard } from "./playbooks-card";
import { ProfileCard } from "./profile-card";
import { SHOW_EVERY_SCOPE, filterNote, ladder } from "./scope";
import { ScopeCard } from "./scope-card";
import { SkillsTable } from "./skills-table";
import type { KnowledgeToast } from "./toast";
import {
  FACTS_REGION_ID,
  KNOWLEDGE_EYEBROW,
  KNOWLEDGE_SUBLINE,
  KNOWLEDGE_TITLE,
  type KnowledgeReadings,
  PLAYBOOKS_REGION_ID,
  PROFILE_REGION_ID,
  SCOPE_REGION_ID,
  SKILLS_REGION_ID,
  readOnlyNote,
} from "./view";

import "./knowledge.css";

/**
 * Knowledge (BG.1, [#417](https://github.com/NobuData/ouroboros/issues/417)) —
 * `docs/mockups/14-knowledge.html`'s page head, its two actions, and the frame the cards sit in.
 *
 * It renders **inside the app shell**, so it starts at its page head and contributes no chrome of
 * its own (`docs/DESIGN_SYSTEM_APP_SHELL.md` § 2): the shell's content pane is the scroll
 * container, and the sidebar's **Knowledge** entry is how a reader arrives. The mockup's topbar is
 * superseded by the shell. This retires the `/knowledge` placeholder #49 held.
 *
 * ### The head: verbatim copy, two actions, both for administrators
 *
 * **Import CLAUDE.md / .cursorrules** (ghost, `app/knowledge/import-sheet.tsx`) and **+ New skill**
 * (primary, `app/knowledge/new-skill.tsx`) are the two ways knowledge enters the system. Both are
 * `owner`/`admin` writes, and for anyone else they are **not drawn** — the issue's ask — with a note
 * under the head saying so, in the settings pages' shape (`app/sources/sources-screen.tsx`).
 *
 * ### The toast is the head's, because both actions leave one
 *
 * The one toast the page shows at a time lives here: a create names its draft, an apply names what
 * it wrote and links to the two review states below. Both dialogs hand theirs up.
 *
 * ### The grid claims only what exists
 *
 * The mockup's left column is the skills table (BG.2, #418, `skills-table.tsx`) and the
 * learned-facts card (BG.3, #419, `facts-card.tsx`), each mounted under the id the toast's
 * anchor for it names; the right is the playbooks card and the repo profile (BG.4, #420,
 * `playbooks-card.tsx` and `profile-card.tsx`) over the scope card (BG.5, #421, `scope-card.tsx`).
 *
 * ### The ladder's steps are decided here, because they narrow two other cards
 *
 * The scope card's steps are computed in this component (`ladder`, `app/knowledge/scope.ts`) from
 * the page's reads and the tenant chip's focus repository, and the step a reader presses is this
 * component's state: the skills table and the facts card are handed its filter, and a note above
 * the grid says the page is narrowed and offers the way back. The chip's choice lives in this
 * browser (`app/shell/focus-repo.ts`), so the server renders the Org step as current and the
 * chip's repository takes over in the same pass, as the chip itself does.
 *
 * @param props.readings What the reader was able to read, and why not for the rest.
 * @param props.mayAdminister Whether this reader is an `owner` or an `admin` — the roles the two
 *   actions are for.
 * @param props.mayDecide Whether this reader is an `owner`, an `admin` or a `member` — the roles
 *   that decide a fact (BF.2's rule; a viewer reads) and that run a playbook on an issue (the
 *   queue write's rule).
 * @param props.role The reader's strongest role, for the read-only note.
 * @param props.workspaceId The workspace's id — what the focus-repo chip's choice is keyed by.
 * @param props.workspaceSlug The workspace's slug — the scope ladder's Org step.
 * @returns The screen.
 */
export function KnowledgeScreen({
  readings,
  mayAdminister,
  mayDecide,
  role,
  workspaceId,
  workspaceSlug,
}: Readonly<{
  readings: KnowledgeReadings;
  mayAdminister: boolean;
  mayDecide: boolean;
  role: Role;
  workspaceId: string;
  workspaceSlug: string;
}>) {
  const [toast, setToast] = useState<KnowledgeToast | null>(null);
  const [narrowed, setNarrowed] = useState<SkillScope | null>(null);
  const focus = useFocusRepo(workspaceId);

  const steps = ladder({
    skills: readings.skills,
    facts: readings.facts,
    repos: readings.repos,
    focus,
    workspace: workspaceSlug,
  });
  // The step narrowing the page — re-derived each render, so its repository follows the chip.
  const step = steps.find((one) => one.scope === narrowed) ?? null;
  const filter = step?.filter ?? null;

  return (
    <main className="knowledge">
      <div className="knowledge__head">
        <div className="knowledge__headings">
          <Eyebrow>{KNOWLEDGE_EYEBROW}</Eyebrow>
          <h1 className="knowledge__title">{KNOWLEDGE_TITLE}</h1>
          <p className="knowledge__sub">{KNOWLEDGE_SUBLINE}</p>
        </div>
        {mayAdminister && (
          <div className="knowledge__actions">
            <ImportSheet onImported={setToast} repos={readings.repos} workspaceId={workspaceId} />
            <NewSkill onCreated={setToast} repos={readings.repos} skills={readings.skills} />
          </div>
        )}
      </div>

      {!mayAdminister && <ReadOnlyNote role={role} />}

      <KnowledgeToastSeat onDismiss={() => { setToast(null); }} toast={toast} />

      {step !== null && (
        <div className="knowledge-filter" role="status">
          <span className="knowledge-filter__text">{filterNote(step)}</span>
          <Button onClick={() => { setNarrowed(null); }} size="sm" tone="ghost">
            {SHOW_EVERY_SCOPE}
          </Button>
        </div>
      )}

      <div className="knowledge__grid">
        <div className="knowledge__main">
          {/* The seats carry the ids the toast's anchors name, so a link lands on the region. */}
          <div className="knowledge__seat" id={SKILLS_REGION_ID}>
            <SkillsTable
              filter={filter}
              mayAdminister={mayAdminister}
              onToast={setToast}
              readAt={readings.readAt}
              skills={readings.skills}
              stats={readings.stats}
            />
          </div>
          <div className="knowledge__seat" id={FACTS_REGION_ID}>
            <FactsCard
              facts={readings.facts}
              filter={filter}
              mayDecide={mayDecide}
              onToast={setToast}
              readAt={readings.readAt}
              repos={readings.repos}
              tickets={readings.tickets}
            />
          </div>
        </div>
        <div className="knowledge__aside">
          <div className="knowledge__seat" id={PLAYBOOKS_REGION_ID}>
            <PlaybooksCard
              mayAdminister={mayAdminister}
              mayLaunch={mayDecide}
              onToast={setToast}
              playbooks={readings.playbooks}
              readAt={readings.readAt}
              skills={readings.skills}
            />
          </div>
          <div className="knowledge__seat" id={PROFILE_REGION_ID}>
            <ProfileCard
              mayAdminister={mayAdminister}
              onToast={setToast}
              profile={readings.profile}
              readAt={readings.readAt}
              repos={readings.repos}
            />
          </div>
          <div className="knowledge__seat" id={SCOPE_REGION_ID}>
            <ScopeCard
              facts={readings.facts}
              narrowed={narrowed}
              onNarrow={setNarrowed}
              repos={readings.repos}
              skills={readings.skills}
              steps={steps}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Why the head has no actions, for a reader who may not act.
 *
 * @param props.role The reader's strongest role.
 * @returns The note.
 */
function ReadOnlyNote({ role }: Readonly<{ role: Role }>) {
  const note = readOnlyNote(role);

  return (
    <p className="knowledge-readonly" role="note">
      <span className="knowledge-readonly__head">{note.head}</span> {note.body}
    </p>
  );
}
