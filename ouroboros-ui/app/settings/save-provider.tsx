"use client";

import { unstable_rethrow, useRouter } from "next/navigation";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { READ_ONLY_ACCESS, type SettingsAccess } from "./access";
import {
  type BatchSectionId,
  CLEAN,
  type Committers,
  type FieldErrors,
  SAVED_NOTICE,
  SAVE_INTERRUPTED,
  type SaveState,
  type SectionCommitResult,
  type SectionCommitter,
  type SectionValues,
  applyOutcome,
  assertBatchSection,
  commitSave,
  discardEdits,
  dropLanded,
  editField,
  failureSummary,
  fieldId,
  firstRefusedField,
  forgetSection,
  pendingCount,
  rebaseSection,
  sameValue,
  sectionDraft,
  sectionPending,
} from "./save-model";
import { type SettingsSectionId, settingsSection } from "./view";

/**
 * The settings page's save model, met by React
 * (BS.1, [#491](https://github.com/NobuData/ouroboros/issues/491), decision **S7**) — the one
 * state the head's **Save changes**, the dirty bar, the leave guard and every card's fields
 * read.
 *
 * A context rather than props, for the reason `app/models/route-editor.tsx` is one: the
 * readers are not in one subtree. The head's button is drawn by the frame, the bar sits under
 * the tab row, and the fields are inside cards that BS.2–BS.5 mount in the grid — a count
 * threaded to all of them would be four numbers that can disagree about whether there is
 * anything to save. `app/settings/save-model.ts` is the bookkeeping; this is where it meets a
 * component's lifecycle and the router.
 *
 * ### How a card joins
 *
 * A card calls {@link useSettingsSection} with what the server holds and how to write it:
 *
 * ```tsx
 * const fields = useSettingsSection({
 *   baseline: { name: settings.name.value, domain: settings.domain.value },
 *   labels: { name: "Workspace name", domain: "Tenant domain" },
 *   commit: (changes) => saveWorkspace(changes),   // one request: all of it, or none
 * });
 *
 * <TextField
 *   id={fields.id("name")}
 *   label="Workspace name"
 *   value={fields.values.name}
 *   error={fields.error("name")}
 *   readOnly={!fields.editable}
 *   onChange={(event) => fields.set("name", event.target.value)}
 * />
 * ```
 *
 * It does not say *which* section it is. The seat it is mounted in does
 * ({@link SettingsSectionScope}, placed by `app/settings/settings-seat.tsx`), which is what
 * makes the Danger zone's exclusion a matter of construction: a card mounted in a seat whose
 * controls act at once has no dirty state to join, and the hook throws rather than hold a
 * field **Save changes** would never send.
 *
 * ### Read-only is a rendering mode
 *
 * For a reader who may not edit, `editable` is `false`, `set` does nothing, and the count is
 * structurally zero — the card draws the same values without the affordances. The gate that
 * **enforces** is the service's, on every write a `commit` makes.
 *
 * ### What a save does
 *
 * Every dirty section is validated first, then written in page order, stopping at the first
 * refusal (`save-model.ts` says why). Field errors go back to their inputs through
 * {@link SectionFields.error}; the bar says which section and which field; and focus moves to
 * the first input an error names, so the reader is taken to what needs fixing rather than told
 * about it from the top of the page.
 *
 * What landed is then **re-read** (`router.refresh()`), inside the same transition as the
 * save: `saving` stays true until the fresh page has rendered, the landed values are drawn
 * over the stale baseline for exactly that long, and the moment it ends the baseline is the
 * truth — including when the service normalised what it was sent back to what it had.
 */

/** What every surface on the page may ask of the save model. */
export interface SettingsSave {
  /** Who the reader is on this page. */
  readonly access: SettingsAccess;
  /** How many fields are unsaved — the number on **Save changes**. */
  readonly pending: number;
  /** Whether a save is in flight. Every field is inert while it is. */
  readonly saving: boolean;
  /** What the last save could not do, as a sentence — or `null`. Cleared by the next edit, discard or save. */
  readonly failure: string | null;
  /** What is announced about the last save — or `null`. */
  readonly notice: string | null;
  /**
   * How many of one section's fields are unsaved.
   *
   * @param section Any section. One whose controls act at once always answers `0`.
   * @returns The count.
   */
  readonly sectionPending: (section: SettingsSectionId) => number;
  /** Commit every unsaved field, a section at a time. */
  readonly save: () => void;
  /** Drop every unsaved field, restoring what is saved. */
  readonly discard: () => void;
}

/** What the section hook needs beyond what the page reads. */
interface SaveInternals extends SettingsSave {
  /** The dirty state as the page draws it — with the landed overlay only while a save is in flight. */
  readonly state: SaveState;
  /** Set one field. A no-op for a read-only reader and while a save is in flight. */
  readonly edit: (
    section: BatchSectionId,
    field: string,
    value: unknown,
    baseline: SectionValues,
  ) => void;
  /** Take a section's new baseline. */
  readonly rebase: (section: BatchSectionId, baseline: SectionValues) => void;
  /** Put a section on the page; the returned function takes it off again. */
  readonly register: (section: BatchSectionId, registration: Registration) => () => void;
}

/** What a mounted section hands the provider: its committer and labels, read at save time. */
interface Registration {
  /** The section's committer, as of its latest render. */
  readonly committer: () => SectionCommitter;
  /** What its fields are called, as of its latest render. */
  readonly labels: () => Readonly<Record<string, string>>;
}

/** What a surface reads with no provider above it: a read-only page with nothing unsaved. */
const DETACHED: SettingsSave = {
  access: READ_ONLY_ACCESS,
  pending: 0,
  saving: false,
  failure: null,
  notice: null,
  sectionPending: () => 0,
  save: () => {},
  discard: () => {},
};

const SaveContext = createContext<SaveInternals | null>(null);

/** The section a card is mounted in, or `null` outside any seat. */
const SectionContext = createContext<SettingsSectionId | null>(null);

/**
 * Wrap a section's write so that a failure with no answer is an answer.
 *
 * A dropped connection rejects the Server Action's promise, and an unhandled rejection would
 * replace the page with its error boundary — taking every unsaved edit with it. So it becomes
 * a refusal the reader can retry from. Next.js's own signals (a redirect to sign in) are
 * rethrown untouched: they are navigations, not failures.
 *
 * @param committer The section's committer.
 * @returns The same committer, whose `commit` never rejects with anything but a framework signal.
 */
function guarded(committer: SectionCommitter): SectionCommitter {
  return {
    ...committer,
    commit: async (changes, draft): Promise<SectionCommitResult> => {
      try {
        return await committer.commit(changes, draft);
      } catch (error) {
        unstable_rethrow(error);

        return { ok: false, reason: SAVE_INTERRUPTED };
      }
    },
  };
}

/** What the provider takes. */
export interface SettingsSaveProviderProps {
  /** Who the reader is — `app/settings/access.ts`'s answer, decided by the route. */
  readonly access: SettingsAccess;
  /** The page. */
  readonly children: ReactNode;
}

/**
 * The provider.
 *
 * Mount it keyed by the workspace: the dirty state is one workspace's, and a switch must not
 * carry an unsaved name into another.
 *
 * @param props See {@link SettingsSaveProviderProps}.
 * @returns The children, with the save model above them.
 */
export function SettingsSaveProvider({ access, children }: SettingsSaveProviderProps) {
  const router = useRouter();

  const [state, setState] = useState<SaveState>(CLEAN);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The input to move focus to once the refusal that named it has rendered. An object rather
   * than the id, so a second refusal of the same field is a new value and moves focus again.
   */
  const [focus, setFocus] = useState<{ readonly id: string } | null>(null);
  /**
   * A transition rather than a flag, for `app/models/route-editor.tsx`'s reason and one more:
   * a write that ends in the framework's own signal — a `401` redirecting to sign in — has to
   * be rethrown where React can see it, and an async transition is what carries it there.
   */
  const [saving, startSaving] = useTransition();

  /** The sections on the page. A ref: nothing renders from which cards are mounted. */
  const registrations = useRef(new Map<BatchSectionId, Registration>());
  /** A latch as well as the state: two presses inside one frame both read `saving` as false. */
  const inFlight = useRef(false);

  const editable = access.mayEdit && !saving;

  // A reader who stops being allowed to edit holds no edits: the dirty state is empty by
  // construction for them, not merely hidden — so a demotion that arrives with a re-read
  // cannot leave a bar offering to save what the service would refuse. Adjusted during
  // render, the way React asks state derived from a changed prop to be.
  const [couldEdit, setCouldEdit] = useState(access.mayEdit);
  if (couldEdit !== access.mayEdit) {
    setCouldEdit(access.mayEdit);
    if (!access.mayEdit) {
      setState(CLEAN);
      setFailure(null);
      setNotice(null);
      setFocus(null);
    }
  }

  /**
   * The dirty state as the page draws it. What a save wrote is drawn over the stale baseline
   * only while that save — and the re-read it asked for — is in flight; after it, the baseline
   * is the truth and the overlay is ignored (and dropped by the next change).
   */
  const shown = useMemo(() => (saving ? state : dropLanded(state)), [saving, state]);

  const edit = useCallback(
    (section: BatchSectionId, field: string, value: unknown, baseline: SectionValues): void => {
      if (!editable) return;

      setState((now) => editField(dropLanded(now), section, field, value, baseline));
      setFailure(null);
      setNotice(null);
    },
    [editable],
  );

  const rebase = useCallback((section: BatchSectionId, baseline: SectionValues): void => {
    setState((now) => rebaseSection(now, section, baseline));
  }, []);

  const register = useCallback((section: BatchSectionId, registration: Registration) => {
    // One card per section: `commit` is the section's atomicity, and two cards would be two
    // requests — with the second silently replacing the first here.
    if (registrations.current.has(section)) {
      throw new Error(
        `The "${settingsSection(section).title}" section already has a card joined to the save ` +
          "model. A section commits through one card: give the section's fields one " +
          "useSettingsSection call.",
      );
    }

    registrations.current.set(section, registration);

    return () => {
      if (registrations.current.get(section) !== registration) return;

      registrations.current.delete(section);
      setState((now) => forgetSection(now, section));
    };
  }, []);

  const discard = useCallback((): void => {
    if (inFlight.current) return;

    setState((now) => discardEdits(dropLanded(now)));
    setFailure(null);
    setNotice(null);
  }, []);

  const save = useCallback((): void => {
    const unsaved = dropLanded(state);
    if (!access.mayEdit || inFlight.current || pendingCount(unsaved) === 0) return;

    const committers: Committers = new Map(
      [...registrations.current].map(([section, { committer }]) => [section, guarded(committer())]),
    );
    const labels = new Map(
      [...registrations.current].map(([section, registration]) => [section, registration.labels()]),
    );

    inFlight.current = true;
    setState(dropLanded);
    setFailure(null);
    setNotice(null);

    startSaving(async () => {
      try {
        const outcome = await commitSave(unsaved, committers);
        const refused = firstRefusedField(outcome);

        setState((now) => applyOutcome(now, outcome));
        setFailure(failureSummary(outcome, labels));
        setNotice(outcome.kind === "saved" ? SAVED_NOTICE : null);
        setFocus(refused === null ? null : { id: fieldId(refused.section, refused.field) });

        if (outcome.kind !== "invalid" && outcome.landed.length > 0) {
          // What landed is re-read rather than kept as a copy of what was sent, so the cards
          // draw what the server holds. Asked for inside this hook's own transition — which
          // an `await` has left, so it is entered again — so that `saving` stays true until
          // the fresh page has rendered, and the landed overlay is drawn for exactly that long.
          startSaving(() => {
            router.refresh();
          });
        }
      } finally {
        inFlight.current = false;
      }
    });
  }, [access.mayEdit, router, state]);

  // After the refusal has rendered — the field's error is in the document, and so is the
  // input it describes — take the reader to it.
  useEffect(() => {
    if (focus === null) return;

    document.getElementById(focus.id)?.focus();
  }, [focus]);

  const value = useMemo<SaveInternals>(
    () => ({
      access,
      pending: pendingCount(shown),
      saving,
      failure,
      notice,
      sectionPending: (section) =>
        section in shown.edits ? sectionPending(shown, section as BatchSectionId) : 0,
      save,
      discard,
      state: shown,
      edit,
      rebase,
      register,
    }),
    [access, shown, saving, failure, notice, save, discard, edit, rebase, register],
  );

  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>;
}

/**
 * The page's save model.
 *
 * @returns The model — or, with no provider above, a read-only page with nothing unsaved, so a
 *   component renders sensibly in a story or a suite of its own rather than throwing.
 */
export function useSettingsSave(): SettingsSave {
  return useContext(SaveContext) ?? DETACHED;
}

/**
 * Who the reader is on this page.
 *
 * @returns The access the route decided — read-only with no provider above.
 */
export function useSettingsAccess(): SettingsAccess {
  return useSettingsSave().access;
}

/**
 * Say which section everything beneath is mounted in.
 *
 * `app/settings/settings-seat.tsx` places one around every seat, so a card never names its own
 * section — and cannot name a different one.
 *
 * @param props.section The section.
 * @param props.children The seat's content.
 * @returns The children, scoped.
 */
export function SettingsSectionScope({
  section,
  children,
}: Readonly<{ section: SettingsSectionId; children: ReactNode }>) {
  return <SectionContext.Provider value={section}>{children}</SectionContext.Provider>;
}

/**
 * The section this component is mounted in.
 *
 * @returns The section's id, or `null` outside any seat.
 */
export function useSettingsSectionId(): SettingsSectionId | null {
  return useContext(SectionContext);
}

/** The names of a section's fields. */
type FieldName<T> = keyof T & string;

/**
 * A section's fields as its card types them: any object of named values.
 *
 * `object` rather than an index signature, so a card may describe its fields with an
 * `interface` — which carries no implicit index signature and would not satisfy one.
 */
type Fields = object;

/** What a card gives the save model for its section. */
export interface SectionOptions<T extends Fields> {
  /** What the server holds for each field, as the page last read it. */
  readonly baseline: T;
  /**
   * Write the section's changes in **one** request that takes all of them or none.
   *
   * @param changes Only the unsaved fields.
   * @param draft Every field as it stands.
   * @returns Whether it landed; when not, why, and what was wrong with which fields.
   */
  readonly commit: (changes: Partial<T>, draft: T) => Promise<SectionCommitResult>;
  /**
   * Check the section in the browser before anything is sent.
   *
   * @param draft Every field as it stands.
   * @param changes Only the unsaved fields.
   * @returns An error per field that is wrong; empty when the section may be sent.
   */
  readonly validate?: (draft: T, changes: Partial<T>) => Partial<Record<FieldName<T>, string>>;
  /** What each field is called, for the sentence that reports a refusal. */
  readonly labels?: Partial<Record<FieldName<T>, string>>;
}

/** What a card reads and does with its section's fields. */
export interface SectionFields<T extends Fields> {
  /** Whether the fields may be changed now: the reader may edit, and no save is in flight. */
  readonly editable: boolean;
  /** Every field as it stands — the unsaved value where there is one, the saved one otherwise. */
  readonly values: T;
  /** How many of the section's fields are unsaved. */
  readonly pending: number;
  /** Why the section was not saved by the last attempt, or `null`. */
  readonly refusal: string | null;
  /**
   * Set a field. Setting it back to the saved value makes it clean again.
   *
   * @param field The field's name.
   * @param value Its new value.
   */
  readonly set: <K extends FieldName<T>>(field: K, value: T[K]) => void;
  /**
   * Whether a field is unsaved.
   *
   * @param field The field's name.
   * @returns `true` while its value differs from what is saved.
   */
  readonly isDirty: (field: FieldName<T>) => boolean;
  /**
   * What the last save found wrong with a field — the control's `error`.
   *
   * @param field The field's name.
   * @returns The sentence, or `undefined` when nothing is wrong with it.
   */
  readonly error: (field: FieldName<T>) => string | undefined;
  /**
   * The id to give a field's control, so a refusal can move focus to it.
   *
   * @param field The field's name.
   * @returns The id.
   */
  readonly id: (field: FieldName<T>) => string;
}

/**
 * Join the page's save model as the section this card is mounted in.
 *
 * @param options See {@link SectionOptions}.
 * @returns The section's fields — see {@link SectionFields}. With no provider or no seat above
 *   it, a read-only view over `baseline`, so a card renders on its own.
 * @throws {Error} When the card is mounted in a section whose controls act at once.
 * @typeParam T The section's fields.
 */
export function useSettingsSection<T extends Fields>(options: SectionOptions<T>): SectionFields<T> {
  const model = useContext(SaveContext);
  const section = useContext(SectionContext);
  const { baseline } = options;
  /** The same baseline, as the save model holds every section's: values by field name. */
  const saved = baseline as SectionValues;

  if (section !== null) assertBatchSection(section);

  const joined = model !== null && section !== null;

  /** The card's latest options, read when a save runs rather than when the card mounted. */
  const latest = useRef(options);
  /** The baseline the dirty state was last told about. */
  const seen = useRef<SectionValues>(saved);

  useEffect(() => {
    latest.current = options;
  });

  const register = model?.register;
  const rebase = model?.rebase;

  useEffect(() => {
    if (register === undefined || section === null) return;

    return register(section, {
      committer: () => ({
        baseline: latest.current.baseline as SectionValues,
        validate:
          latest.current.validate === undefined
            ? undefined
            : (draft, changes) =>
                (latest.current.validate?.(draft as T, changes as Partial<T>) ?? {}) as FieldErrors,
        commit: (changes, draft) => latest.current.commit(changes as Partial<T>, draft as T),
      }),
      labels: () => (latest.current.labels ?? {}) as Readonly<Record<string, string>>,
    });
  }, [register, section]);

  // The page re-read the section: tell the dirty state, once per real change. Compared by
  // value, because a card builds its baseline object anew on every render.
  useEffect(() => {
    if (rebase === undefined || section === null || sameValue(seen.current, saved)) return;

    seen.current = saved;
    rebase(section, saved);
  });

  return useMemo<SectionFields<T>>(() => {
    if (!joined) {
      return {
        editable: false,
        values: baseline,
        pending: 0,
        refusal: null,
        set: () => {},
        isDirty: () => false,
        error: () => undefined,
        id: (field) => `settings-field-${field}`,
      };
    }

    const { state } = model;

    return {
      editable: model.access.mayEdit && !model.saving,
      values: sectionDraft(state, section, saved) as T,
      pending: sectionPending(state, section),
      refusal: state.refusals[section] ?? null,
      set: (field, value) => {
        model.edit(section, field, value, saved);
      },
      isDirty: (field) => field in (state.edits[section] ?? {}),
      error: (field) => state.errors[section]?.[field],
      id: (field) => fieldId(section, field),
    };
  }, [joined, model, section, baseline, saved]);
}
