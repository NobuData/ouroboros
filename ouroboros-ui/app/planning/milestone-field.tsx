"use client";

import { useEffect, useState } from "react";

import { SelectField, TextField } from "@/app/ui";

import {
  MAX_MILESTONE_LENGTH,
  MILESTONES_LOADING,
  MILESTONES_UNSUPPORTED,
  MILESTONE_LABEL,
  type MilestoneChoice,
  NEW_MILESTONE_HINT,
  NEW_MILESTONE_LABEL,
  NEW_MILESTONE_OPTION,
  NEW_MILESTONE_VALUE,
  NO_MILESTONE,
} from "./generator";
import { readMilestones } from "./generator-actions";

import "./planning.css";

/**
 * The generator card's **Milestone ▾** — a per-source list with an inline create
 * (AM.2, [#284](https://github.com/NobuData/ouroboros/issues/284)).
 *
 * The options are the chosen tracker's own open milestones, asked for whenever the tracker changes
 * (`GET /api/v1/planning/sources/{source}/milestones`). **Creating one is naming it**: AL.3's push
 * ensures a milestone by name, so *New milestone…* opens a text field and the name travels on the
 * batch — nothing is written to the tracker until the push.
 *
 * It is the platform's `<select>`, for the reasons `SelectField` gives. A tracker without
 * milestones, one that could not be asked, and one still being asked each disable the select and
 * say which in its hint.
 */

/** What the field holds about the tracker it last asked. */
type Listing =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | { readonly state: "loaded"; readonly supported: boolean; readonly names: readonly string[] }
  | { readonly state: "failed"; readonly reason: string };

/** What the field takes. */
export interface MilestoneFieldProps {
  /** The control's id. */
  readonly id: string;
  /** The chosen tracker, or `null` — no milestones to ask for. */
  readonly sourceId: string | null;
  /** What is chosen. */
  readonly value: MilestoneChoice;
  /** Called with the new choice. */
  readonly onChange: (choice: MilestoneChoice) => void;
  /** Why the field cannot change, when it cannot. */
  readonly reason?: string;
}

/** The select's value for an existing milestone — prefixed so no name can collide with the others. */
const EXISTING_PREFIX = "m:";

/**
 * The field.
 *
 * @param props See {@link MilestoneFieldProps}.
 * @returns The select, with the inline create beneath it while it is chosen.
 */
export function MilestoneField({ id, sourceId, value, onChange, reason }: MilestoneFieldProps) {
  const [held, setHeld] = useState<{ sourceId: string | null; listing: Listing }>(() => ({
    sourceId,
    listing: sourceId === null ? { state: "idle" } : { state: "loading" },
  }));

  // The tracker moved: forget the old list during render, before anything is painted from it.
  if (held.sourceId !== sourceId) {
    setHeld({ sourceId, listing: sourceId === null ? { state: "idle" } : { state: "loading" } });
  }

  useEffect(() => {
    if (sourceId === null) return;

    let current = true;

    void readMilestones(sourceId).then((outcome) => {
      if (!current) return;

      setHeld({
        sourceId,
        listing: outcome.ok
          ? {
              state: "loaded",
              supported: outcome.value.supported,
              names: outcome.value.milestones.map((milestone) => milestone.name),
            }
          : { state: "failed", reason: outcome.refusal.message },
      });
    });

    return () => {
      current = false;
    };
  }, [sourceId]);

  const { listing } = held;
  const names = listing.state === "loaded" ? [...listing.names] : [];

  // A batch opened on a milestone the tracker no longer lists still shows what it carries.
  if (value.mode === "existing" && !names.includes(value.name)) names.unshift(value.name);

  const hint = listingHint(listing);
  const usable = listing.state === "loaded" && listing.supported;
  const inert = reason !== undefined || !usable;

  /**
   * Take the select's new value.
   *
   * @param selected The option's value.
   */
  function choose(selected: string): void {
    if (selected === "") onChange({ mode: "none" });
    else if (selected === NEW_MILESTONE_VALUE) onChange({ mode: "new", name: "" });
    else onChange({ mode: "existing", name: selected.slice(EXISTING_PREFIX.length) });
  }

  return (
    <div className="planning-gen__milestone">
      <SelectField
        disabled={inert}
        hint={reason ?? hint}
        id={id}
        label={MILESTONE_LABEL}
        onChange={(event) => { choose(event.currentTarget.value); }}
        value={selectValue(value)}
      >
        <option value="">{NO_MILESTONE}</option>
        {names.map((name) => (
          <option key={name} value={`${EXISTING_PREFIX}${name}`}>
            {name}
          </option>
        ))}
        <option value={NEW_MILESTONE_VALUE}>{NEW_MILESTONE_OPTION}</option>
      </SelectField>

      {value.mode === "new" && (
        <TextField
          autoComplete="off"
          disabled={reason !== undefined}
          hint={NEW_MILESTONE_HINT}
          id={`${id}-new`}
          label={NEW_MILESTONE_LABEL}
          maxLength={MAX_MILESTONE_LENGTH}
          onChange={(event) => { onChange({ mode: "new", name: event.currentTarget.value }); }}
          value={value.name}
        />
      )}
    </div>
  );
}

/**
 * The select's value for a choice.
 *
 * @param choice What is chosen.
 * @returns The option value.
 */
function selectValue(choice: MilestoneChoice): string {
  if (choice.mode === "none") return "";
  if (choice.mode === "new") return NEW_MILESTONE_VALUE;

  return `${EXISTING_PREFIX}${choice.name}`;
}

/**
 * What the select's hint says about its list.
 *
 * @param listing What was asked.
 * @returns The sentence, or `undefined` when the list is usable.
 */
function listingHint(listing: Listing): string | undefined {
  switch (listing.state) {
    case "idle":
    case "loading":
      return listing.state === "loading" ? MILESTONES_LOADING : undefined;
    case "failed":
      return listing.reason;
    case "loaded":
      return listing.supported ? undefined : MILESTONES_UNSUPPORTED;
  }
}
