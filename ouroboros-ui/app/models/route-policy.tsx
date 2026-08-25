"use client";

import Link from "next/link";
import { type ChangeEvent, useId, useState } from "react";

import { REGISTRY_PATH } from "@/app/paths";
import { TextField, Toggle } from "@/app/ui";

import { SAVING, floorDefault } from "./chain";
import {
  ALLOW_LOCAL_LABEL,
  FLOOR_HOP_LABEL,
  MAX_COST_HINT,
  MAX_COST_LABEL,
  OPEN_REGISTRY,
  POLICY_READ_ONLY,
  REGISTRY_NOTE,
  floorSentence,
  formatMaxCost,
  parseMaxCost,
} from "./inspector";
import { useRouteEditor } from "./route-editor";

import "./models.css";

/**
 * The inspector's policy controls ([#203](https://github.com/NobuData/ouroboros/issues/203))
 * — mockup 06's two switches, the **Max cost per run** field and the registry footnote, under
 * the selected route's chain.
 *
 * ### Nothing here saves
 *
 * Every control edits the route editor's draft of the route — the same draft the chain editor
 * moves hops on — through `app/models/chain.ts`'s `setAllowLocal`, `setFloor` and
 * `setMaxCost`. That is the whole of *policy edits join the AA.3 dirty batch*: a flipped
 * switch marks the row *changed*, counts in the bar, is discarded by **Discard**, and commits
 * with **Save routes** and never on change. A switch that persisted on press would be the one
 * control on this page that skipped the batch, and a reader could not tell which.
 *
 * ### The floor is a sentence with a number in it
 *
 * The mockup's *Fail run instead of degrading below fallback 2* is the page's sharpest promise,
 * and it is drawn as that sentence rather than as a field labelled *floor_hop_index*. The
 * number is the floor itself. While the switch is off the sentence names the floor the switch
 * would set (`floorDefault`); while it is on, the number becomes a select over the chain's
 * hops, so a reader can move the floor without leaving the sentence. Turning the switch off is
 * `floorHopIndex: null`, which is how the contract spells *no floor*.
 *
 * ### The cap is parsed as it is typed, and refused inline
 *
 * The field is controlled by its own text so a reader can type `2.5` without the page
 * rewriting it to `$2.50` under their cursor. Every keystroke is parsed: an amount lands on
 * the draft at once, and a malformed one is refused **inline** — the field's `error`, which
 * `TextField` wires into the control's description and `aria-invalid` — while the draft keeps
 * the last amount that parsed. On blur an accepted amount is reprinted in the cap's own
 * spelling.
 *
 * ### Read-only is a rendering mode here too
 *
 * A member sees the switches in their real positions and the cap as it stands, every control
 * inert with the one reason (`POLICY_READ_ONLY`) — the design system's permission-limited
 * state (§ 3.3), because a route's policy is part of its story and a card that hid it from a
 * reader who may only read would look like a route with none. The gate that enforces is the
 * service's; `app/models/route-actions.ts` says what happens to a member who reaches the write.
 */

/** What the controls take. */
export interface RoutePolicyProps {
  /** The selected route's task kind. */
  readonly kind: string;
}

/**
 * The controls.
 *
 * @param props See {@link RoutePolicyProps}.
 * @returns The two switches, the field and the footnote — or nothing for a kind with no route,
 *   which the chain editor has already explained.
 */
export function RoutePolicy({ kind }: RoutePolicyProps) {
  const editor = useRouteEditor();
  const draft = editor.draft(kind);
  const noteId = useId();

  if (draft === null) return null;

  // Every control is inert while the batch is in flight, and for a role that may not edit —
  // most consequential reason first, and one reason for all of them.
  const reason = !editor.editable ? POLICY_READ_ONLY : editor.saving ? SAVING : undefined;
  const inert = reason !== undefined;

  const floorOn = draft.floorHopIndex !== null;
  const floorHop = draft.floorHopIndex ?? floorDefault(draft);
  const sentence = floorSentence(floorHop);

  return (
    <div className="models-policy">
      <div className="models-policy__row">
        <span className="models-policy__label">{ALLOW_LOCAL_LABEL}</span>
        <Toggle
          checked={draft.allowLocalFallback}
          describedBy={inert ? noteId : undefined}
          label={ALLOW_LOCAL_LABEL}
          onClick={() => {
            editor.allowLocal(kind, !draft.allowLocalFallback);
          }}
          reason={reason}
        />
      </div>

      <div className="models-policy__row">
        <span className="models-policy__label">
          {floorOn ? (
            <>
              Fail run instead of degrading below fallback{" "}
              <select
                aria-label={FLOOR_HOP_LABEL}
                className="models-policy__hop"
                disabled={inert}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  editor.floor(kind, Number(event.target.value));
                }}
                title={reason}
                value={floorHop}
              >
                {draft.hops.map((hop, index) => (
                  <option key={hop.id} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </>
          ) : (
            sentence
          )}
        </span>
        <Toggle
          checked={floorOn}
          describedBy={inert ? noteId : undefined}
          label={sentence}
          onClick={() => {
            editor.floor(kind, floorOn ? null : floorDefault(draft));
          }}
          reason={reason}
        />
      </div>

      <MaxCostField
        cents={draft.maxCostCentsPerRun}
        onChange={(cents) => {
          editor.maxCost(kind, cents);
        }}
        reason={reason}
      />

      {inert && (
        <p className="models-policy__readonly" id={noteId}>
          {reason}
        </p>
      )}

      <p className="models-policy__note">
        {REGISTRY_NOTE}{" "}
        <Link className="models-policy__link" href={REGISTRY_PATH}>
          {OPEN_REGISTRY}
        </Link>
      </p>
    </div>
  );
}

/** What the field holds between keystrokes: the text, and what is wrong with it. */
interface CostText {
  /** The cap the text was last known to agree with — how an outside change is noticed. */
  readonly cents: number | null;
  /** What is in the box. */
  readonly text: string;
  /** Why the text is refused, or `null` while it parses. */
  readonly error: string | null;
}

/**
 * Mockup 06's **Max cost per run** — a text field whose value is the cap in cents.
 *
 * @param props.cents The cap as the draft holds it.
 * @param props.onChange Where a parsed amount goes. Called only with text that parses.
 * @param props.reason Why the field cannot be edited, or `undefined` when it can.
 * @returns The field.
 */
function MaxCostField({
  cents,
  onChange,
  reason,
}: Readonly<{
  cents: number | null;
  onChange: (cents: number | null) => void;
  reason: string | undefined;
}>) {
  const id = useId();
  const [held, setHeld] = useState<CostText>(() => ({ cents, text: formatMaxCost(cents), error: null }));

  // The draft moved under the field — a Discard, a save that landed — so the text follows
  // it. Decided during render rather than in an effect, so the reprint and the draft land in
  // one paint; a keystroke of the reader's own leaves `held.cents` equal to `cents` and is
  // not a move.
  if (held.cents !== cents) {
    setHeld({ cents, text: formatMaxCost(cents), error: null });
  }

  /**
   * Take a keystroke: parse it, and move the draft when it parses.
   *
   * @param text What is in the box now.
   */
  function type(text: string): void {
    const parsed = parseMaxCost(text);

    if (parsed.ok) {
      setHeld({ cents: parsed.cents, text, error: null });
      onChange(parsed.cents);
      return;
    }

    setHeld({ cents, text, error: parsed.reason });
  }

  /** Reprint an accepted amount in the cap's own spelling; leave a refused one as typed. */
  function settle(): void {
    if (held.error === null) setHeld({ cents, text: formatMaxCost(cents), error: null });
  }

  return (
    <TextField
      className="models-policy__cost"
      disabled={reason !== undefined}
      error={held.error ?? undefined}
      hint={reason ?? MAX_COST_HINT}
      id={`${id}-cost`}
      inputMode="decimal"
      label={MAX_COST_LABEL}
      mono
      onBlur={settle}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        type(event.target.value);
      }}
      value={held.text}
    />
  );
}
