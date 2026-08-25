"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";

import { Meter, TextField } from "@/app/ui";

import { setProviderCap } from "./card-actions";
import {
  CAP_READ_ONLY,
  CAP_SAVED,
  CAP_SAVING,
  CAP_WARNING_ONLY,
  NO_CAP,
  capText,
  parseCap,
} from "./caps";
import { CAP_LABEL, type SpendInputs, THIS_MONTH, capValue, meterFor } from "./cards";

/**
 * The card's monthly cap (AE.6, [#232](https://github.com/NobuData/ouroboros/issues/232)):
 * the foot's **Monthly cap** field, and the meter above it that moves the moment the cap does.
 *
 * ### One island in three parts, because the meter and the field share a number
 *
 * The meter is drawn above the models region and the field sits in the foot, with the
 * **Test connection** island between them, so the two cannot be one component without
 * moving the foot's markup into a client file. They share the cap through a context instead:
 * {@link CapScope} holds it, {@link CapMeter} reads it, and {@link CapField} writes it. The
 * card — a Server Component — places the three where the mockup places them and stays a
 * description of a card.
 *
 * The round trip is the switch's (`provider-switch.tsx`): the cap moves when it is saved and
 * reconciles afterwards, the optimistic value living exactly as long as the transition that
 * set it, so a save the service refused goes back on its own and a change made elsewhere
 * arrives as a changed prop. The meter is recomputed from that cap by `cards.ts`'s
 * `meterFor` — the same function the server drew the first paint with — which is what
 * *cap edits round-trip and re-render the meter immediately* means here.
 *
 * ### The field commits on blur and on Enter, and it parses first
 *
 * A save button beside a 92-pixel field would double its width, so the field commits the
 * way a spreadsheet cell does: leave it, or press Enter. What was typed is parsed in the
 * browser (`caps.ts`'s `parseCap`), so a word or a negative number is refused with a sentence
 * under the field and no round trip; a value that parses to what is already stored is
 * normalised in place — `95` becomes `$95` — and saves nothing. Escape puts the stored value
 * back.
 *
 * ### Decision P7, in two places
 *
 * Every capped meter carries `CAP_WARNING_ONLY` as a tooltip on an `ⓘ` after its note, and
 * every editable field carries it as its description and its tooltip — so a reader who sets a
 * cap is told, where they set it, that it warns and does not stop. AF.4
 * ([#237](https://github.com/NobuData/ouroboros/issues/237)) deletes the constant; both
 * uses are then a failed typecheck, which is the point of spelling it once.
 *
 * Pending is plain state rather than `useTransition`'s flag, for the reason
 * `app/models/simulate-sheet.tsx` gives: this state is *drawn* — the field is busy and says
 * so — and an entangled transition would hold a note behind an unrelated write.
 */

/** What the scope holds for the meter and the field. */
interface CapState {
  /** The cap the meter and the field draw — the stored one, or the one just saved. */
  readonly cap: number | null;
  /** The month's row and the seat count, unchanged by any edit. */
  readonly row: SpendInputs["row"];
  readonly seats: SpendInputs["seats"];
  /** Whether a save is in flight. */
  readonly pending: boolean;
  /** Why the last save did not take, or null. */
  readonly failure: string | null;
  /** Whether the last save took, until the next edit. */
  readonly saved: boolean;
  /** Save a cap — the write itself, past parsing. */
  readonly save: (next: number | null) => void;
  /** Clear the last save's notes: the reader is editing again. */
  readonly settle: () => void;
}

const CapContext = createContext<CapState | null>(null);

/**
 * The scope, or the reason there is none — a meter or a field rendered outside one is a
 * programming error worth a sentence rather than a blank card.
 *
 * @returns The state.
 */
function useCap(): CapState {
  const state = useContext(CapContext);

  if (state === null) {
    throw new Error("A cap meter or field must be rendered inside <CapScope>.");
  }

  return state;
}

/** What the scope takes. */
export interface CapScopeProps {
  /** The connection. */
  readonly connectionId: string;
  /** The stored cap, and the meter's other two inputs — `cards.ts`'s `spend`. */
  readonly spend: SpendInputs;
  /** The card's meter and foot, with a {@link CapMeter} and a {@link CapField} in them. */
  readonly children: ReactNode;
}

/**
 * The scope: the cap, optimistic across a save, for the meter and the field beneath it.
 *
 * No element of its own, so the card's flex column still sees the meter and the foot as
 * its direct children and the foot's `margin-top: auto` keeps landing two cards' feet on
 * one line.
 *
 * @param props See {@link CapScopeProps}.
 * @returns The children, in scope.
 */
export function CapScope({ connectionId, spend, children }: CapScopeProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cap, setCap] = useOptimistic(spend.capCents);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useCallback(
    (next: number | null) => {
      if (pending) return;

      setPending(true);
      setFailure(null);
      setSaved(false);

      startTransition(async () => {
        setCap(next);

        const outcome = await setProviderCap(connectionId, next);

        setPending(false);

        if (!outcome.ok) {
          setFailure(outcome.reason);
          return;
        }

        setSaved(true);
        router.refresh();
      });
    },
    [connectionId, pending, router, setCap],
  );

  const settle = useCallback(() => {
    setFailure(null);
    setSaved(false);
  }, []);

  const state = useMemo<CapState>(
    () => ({ cap, row: spend.row, seats: spend.seats, pending, failure, saved, save, settle }),
    [cap, spend.row, spend.seats, pending, failure, saved, save, settle],
  );

  return <CapContext.Provider value={state}>{children}</CapContext.Provider>;
}

/**
 * The meter: the mockup's *This month* line and the bar under it, at the cap in scope.
 *
 * The bar is decoration for the line above it, which already says the figure — so it is
 * `aria-hidden`, the primitive's own rule when it is given no label. The `ⓘ` after a capped
 * line is decision P7's tooltip; its sentence is in the accessibility tree as text, so a
 * screen reader meets it where a pointer would.
 *
 * @returns The meter region.
 */
export function CapMeter() {
  const { cap, row, seats } = useCap();
  const meter = meterFor(cap, row, seats);

  return (
    <div className="providers-card__meter">
      <div className="providers-card__meter-line">
        <span className="providers-card__meter-label">{THIS_MONTH}</span>
        <span className="providers-card__meter-trail">
          <span className="providers-card__meter-figure">
            {meter.figure}
            {meter.note !== null && (
              <span className="providers-card__meter-note"> {meter.note}</span>
            )}
          </span>
          {cap !== null && (
            <span className="providers-card__meter-warning" title={CAP_WARNING_ONLY}>
              <span aria-hidden="true">ⓘ</span>
              <span className="sr-only">{CAP_WARNING_ONLY}</span>
            </span>
          )}
        </span>
      </div>
      {meter.fraction !== null && <Meter tone={meter.tone} value={meter.fraction} />}
    </div>
  );
}

/** What the field takes. */
export interface CapFieldProps {
  /** The connection, for the field's id. */
  readonly connectionId: string;
  /** Whether this reader may change the cap. `false` renders the read-only field. */
  readonly mayAdminister: boolean;
}

/**
 * The foot's **Monthly cap** field.
 *
 * @param props See {@link CapFieldProps}.
 * @returns The field — editable for an administrator, read-only with the reason for anybody
 *   else, and in both cases described by the sentence decision P7 owes it.
 */
export function CapField({ connectionId, mayAdminister }: CapFieldProps) {
  const { cap, pending, failure, saved, save, settle } = useCap();
  const [text, setText] = useState(capText(cap));
  const [seen, setSeen] = useState(cap);
  const [error, setError] = useState<string | null>(null);
  const fieldId = `provider-${connectionId}-cap`;

  // The text follows the cap in scope: a save normalises `95` to `$95`, a refused save puts
  // the stored figure back, and a cap changed elsewhere arrives with the re-read. Adjusted
  // during render, which is how state is derived from a changed value without an effect.
  if (seen !== cap) {
    setSeen(cap);
    setText(capText(cap));
    setError(null);
  }

  if (!mayAdminister) {
    return (
      <TextField
        className="providers-card__cap"
        hint={<span className="sr-only">{CAP_READ_ONLY}</span>}
        id={fieldId}
        label={CAP_LABEL}
        mono
        readOnly
        title={CAP_READ_ONLY}
        value={capValue(cap)}
      />
    );
  }

  /** Commit what was typed: refuse it, normalise it, or save it. */
  function commit(): void {
    if (pending) return;

    const parsed = parseCap(text);

    if (!parsed.ok) {
      setError(parsed.reason);
      return;
    }

    setError(null);

    if (parsed.cents === cap) {
      setText(capText(cap));
      return;
    }

    save(parsed.cents);
  }

  /** Enter commits; Escape puts the stored value back. */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      setText(capText(cap));
      setError(null);
      settle();
    }
  }

  return (
    <TextField
      aria-busy={pending || undefined}
      className="providers-card__cap"
      // A value that is not a cap is the field's error — it marks the control invalid. A save
      // the service refused is not: the value shown is the stored one again, so the refusal
      // is an alert in the hint's line rather than a mark on a figure that is right.
      error={error ?? undefined}
      hint={
        <>
          {pending && <span role="status">{CAP_SAVING}</span>}
          {saved && <span role="status">{CAP_SAVED}</span>}
          {failure !== null && (
            <span className="providers-keys__note--err" role="alert">
              {failure}
            </span>
          )}
          <span className="sr-only">{CAP_WARNING_ONLY}</span>
        </>
      }
      id={fieldId}
      inputMode="decimal"
      label={CAP_LABEL}
      mono
      onBlur={commit}
      onChange={(event) => {
        setText(event.target.value);
        setError(null);
        settle();
      }}
      onKeyDown={onKeyDown}
      placeholder={NO_CAP}
      title={CAP_WARNING_ONLY}
      value={text}
    />
  );
}
