import { fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactElement, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GlobPreview } from "@/app/globs/glob";
import {
  type AutoMergeTerms,
  type DryRunTerms,
  type HumanReviewTerms,
  LABEL_PROBLEMS,
  LOOPS_MAX,
  NEEDS_A_CAP,
  type ProtectedPathsTerms,
  type SpendGuardTerms,
  validatePolicy,
} from "@/app/policies/document";

/**
 * The chip-level condition editors (BS.4, [#494](https://github.com/NobuData/ouroboros/issues/494)),
 * driven the way a reader drives them: every value an editor emits is one the document admits,
 * and the states the document would refuse — a predicate rule with no term, a spend guard with
 * no cap, an amount with a third decimal, a fractional loop count — cannot be reached at all.
 */

// The shared glob editor is fork-independent here: what matters is what this editor hands it.
vi.mock("@/app/globs/glob-editor", () => ({
  GlobEditor: (props: {
    id: string;
    label: string;
    globs: readonly string[];
    readOnly?: boolean;
    onChange: (globs: readonly string[]) => void;
    preview: (globs: readonly string[]) => Promise<GlobPreview>;
  }) => (
    <div data-testid="glob-editor" data-read-only={String(props.readOnly ?? false)}>
      <span>{props.label}</span>
      <span data-testid="globs">{props.globs.join(",")}</span>
      <input aria-label="stub glob input" id={props.id} readOnly />
      <button
        onClick={() => {
          props.onChange([...props.globs, "drivers/**"]);
        }}
        type="button"
      >
        stub add
      </button>
      <button
        onClick={() => {
          void props.preview(props.globs);
        }}
        type="button"
      >
        stub preview
      </button>
    </div>
  ),
}));

const {
  ADD,
  AMOUNT_TOO_SMALL,
  ANY_EFFORT,
  AUTO_MERGE_EFFORT_LABEL,
  AutoMergeEditor,
  DryRunEditor,
  EXCLUDE_A_LABEL,
  HumanReviewEditor,
  LOOPS_LABEL,
  MONTHLY_HINT,
  MONTHLY_LABEL,
  NO_EFFORT_THRESHOLD,
  ONE_FEWER,
  ONE_MORE,
  OR,
  PER_RUN_HINT,
  PER_RUN_LABEL,
  PROTECTED_GLOBS_LABEL,
  ProtectedPathsEditor,
  REVIEW_A_LABEL,
  REVIEW_EFFORT_LABEL,
  SpendGuardEditor,
  controlId,
  loopsConsequence,
  removeLabel,
  reviewSemantics,
} = await import("@/app/policies/rule-editors");

/** What a harness hands back: every emitted value, in order. */
interface Emitted<Terms> {
  readonly calls: Terms[];
}

/**
 * Mount an editor over state it owns, as the card does, recording each emission.
 *
 * @param initial The terms to start from.
 * @param draw The editor, given the terms as they stand and where the next ones go.
 * @returns The record of emissions.
 */
function mount<Terms>(
  initial: Terms,
  draw: (terms: Terms, onChange: (terms: Terms) => void) => ReactElement,
): Emitted<Terms> {
  const calls: Terms[] = [];

  function Harness() {
    const [terms, setTerms] = useState(initial);

    return draw(terms, (next) => {
      calls.push(next);
      setTerms(next);
    });
  }

  render(<Harness />);

  return { calls };
}

/**
 * Type into a field.
 *
 * @param field The input.
 * @param value The text it should hold.
 */
function type(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } });
}

/** The option labels of a select, in order. */
function options(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);
}

describe("auto_merge", () => {
  /**
   * Mount the editor.
   *
   * @param terms The terms to start from.
   * @param readOnly Whether it is inert.
   * @returns The emissions.
   */
  function draw(terms: AutoMergeTerms, readOnly = false): Emitted<AutoMergeTerms> {
    return mount(terms, (now, onChange) => (
      <AutoMergeEditor idBase="am" onChange={onChange} readOnly={readOnly} terms={now} />
    ));
  }

  it("offers the five efforts, and Any effort only while a label is excluded", () => {
    draw({ maxEffort: "m", excludedLabels: [] });

    expect(options(screen.getByLabelText(AUTO_MERGE_EFFORT_LABEL))).toEqual(["XS", "S", "M", "L", "XL"]);
  });

  it("changes the effort, and can drop it once a label carries the rule", () => {
    const { calls } = draw({ maxEffort: "m", excludedLabels: ["refactor"] });
    const select = screen.getByLabelText(AUTO_MERGE_EFFORT_LABEL);

    expect(options(select)).toEqual([ANY_EFFORT, "XS", "S", "M", "L", "XL"]);
    expect(select).toHaveProperty("id", controlId("am", "effort"));

    fireEvent.change(select, { target: { value: "s" } });
    fireEvent.change(select, { target: { value: "" } });

    expect(calls).toEqual([
      { maxEffort: "s", excludedLabels: ["refactor"] },
      { maxEffort: null, excludedLabels: ["refactor"] },
    ]);
    // The label is now the rule's only term: it has no remove control.
    expect(screen.queryByRole("button", { name: removeLabel("Stop excluding", "refactor") })).toBeNull();
  });

  it("adds a trimmed label on the button and on Enter, and clears the field", () => {
    const { calls } = draw({ maxEffort: "m", excludedLabels: [] });
    const field = screen.getByLabelText(EXCLUDE_A_LABEL);

    type(field, "  refactor ");
    fireEvent.click(screen.getByRole("button", { name: ADD }));
    type(field, "infra");
    fireEvent.keyDown(field, { key: "Enter" });

    expect(calls).toEqual([
      { maxEffort: "m", excludedLabels: ["refactor"] },
      { maxEffort: "m", excludedLabels: ["refactor", "infra"] },
    ]);
    expect(field).toHaveProperty("value", "");
    expect(field).toHaveProperty("id", controlId("am", "label"));
  });

  it("emits nothing for a label that cannot join, and says why on the field", () => {
    const { calls } = draw({ maxEffort: "m", excludedLabels: ["refactor"] });
    const field = screen.getByLabelText(EXCLUDE_A_LABEL);

    fireEvent.click(screen.getByRole("button", { name: ADD }));
    expect(screen.getByRole("alert").textContent).toBe(LABEL_PROBLEMS.empty);

    type(field, "refactor");
    // Typing clears the last refusal.
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe(LABEL_PROBLEMS.duplicate);

    type(field, "x".repeat(65));
    fireEvent.click(screen.getByRole("button", { name: ADD }));
    expect(screen.getByRole("alert").textContent).toBe(LABEL_PROBLEMS.too_long);
    expect(field.getAttribute("aria-invalid")).toBe("true");

    expect(calls).toEqual([]);
  });

  it("removes a label while another term stands", () => {
    const { calls } = draw({ maxEffort: null, excludedLabels: ["refactor", "infra"] });

    fireEvent.click(screen.getByRole("button", { name: removeLabel("Stop excluding", "refactor") }));

    expect(calls).toEqual([{ maxEffort: null, excludedLabels: ["infra"] }]);
    expect(screen.queryByRole("button", { name: removeLabel("Stop excluding", "infra") })).toBeNull();
  });

  it("stays drawn and inert while a save is in flight", () => {
    const { calls } = draw({ maxEffort: "m", excludedLabels: ["refactor"] }, true);

    expect(screen.getByLabelText(AUTO_MERGE_EFFORT_LABEL)).toHaveProperty("disabled", true);
    expect(screen.getByLabelText(EXCLUDE_A_LABEL)).toHaveProperty("readOnly", true);
    expect(
      screen.getByRole("button", { name: removeLabel("Stop excluding", "refactor") }),
    ).toHaveProperty("disabled", true);

    type(screen.getByLabelText(EXCLUDE_A_LABEL), "infra");
    fireEvent.click(screen.getByRole("button", { name: ADD }));

    expect(calls).toEqual([]);
  });
});

describe("human_review", () => {
  /**
   * Mount the editor.
   *
   * @param terms The terms to start from.
   * @returns The emissions.
   */
  function draw(terms: HumanReviewTerms): Emitted<HumanReviewTerms> {
    return mount(terms, (now, onChange) => (
      <HumanReviewEditor idBase="hr" onChange={onChange} readOnly={false} terms={now} />
    ));
  }

  it("writes the OR out as a word, between the labels and the effort, and as a sentence", () => {
    draw({ labels: ["refactor"], minEffort: "l" });

    const or = screen.getByText(OR, { selector: "p" });
    const labels = screen.getByLabelText(REVIEW_A_LABEL);
    const effort = screen.getByLabelText(REVIEW_EFFORT_LABEL);

    expect(labels.compareDocumentPosition(or) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(or.compareDocumentPosition(effort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      screen.getByText(
        "A person reviews when the ticket is labelled refactor OR has an effort of at least L.",
      ),
    ).toBeTruthy();
  });

  it("states the semantics for every shape of the rule", () => {
    expect(reviewSemantics({ labels: [], minEffort: "m" })).toBe(
      "A person reviews when the ticket has an effort of at least M.",
    );
    expect(reviewSemantics({ labels: ["a", "b"], minEffort: null })).toBe(
      "A person reviews when the ticket is labelled a OR is labelled b.",
    );
  });

  it("offers No effort threshold only while a label is listed, and keeps one term always", () => {
    const { calls } = draw({ labels: [], minEffort: "l" });
    const select = screen.getByLabelText(REVIEW_EFFORT_LABEL);

    expect(options(select)).toEqual(["XS", "S", "M", "L", "XL"]);

    type(screen.getByLabelText(REVIEW_A_LABEL), "refactor");
    fireEvent.click(screen.getByRole("button", { name: ADD }));
    expect(options(select)).toEqual([NO_EFFORT_THRESHOLD, "XS", "S", "M", "L", "XL"]);

    fireEvent.change(select, { target: { value: "" } });
    expect(
      screen.queryByRole("button", { name: removeLabel("Stop requiring review for", "refactor") }),
    ).toBeNull();

    fireEvent.change(select, { target: { value: "xl" } });
    fireEvent.click(
      screen.getByRole("button", { name: removeLabel("Stop requiring review for", "refactor") }),
    );

    expect(calls).toEqual([
      { labels: ["refactor"], minEffort: "l" },
      { labels: ["refactor"], minEffort: null },
      { labels: ["refactor"], minEffort: "xl" },
      { labels: [], minEffort: "xl" },
    ]);
    expect(options(select)).toEqual(["XS", "S", "M", "L", "XL"]);
  });
});

describe("protected_paths", () => {
  it("hands the shared glob editor the globs, the id, the label, the preview and the inert flag", () => {
    const previewPaths = vi.fn<(globs: readonly string[]) => Promise<GlobPreview>>(() =>
      Promise.resolve({ ok: true, repositories: [] }),
    );
    const { calls } = mount<ProtectedPathsTerms>({ globs: ["boot/**"] }, (now, onChange) => (
      <ProtectedPathsEditor
        idBase="pp"
        onChange={onChange}
        previewPaths={previewPaths}
        readOnly={false}
        terms={now}
      />
    ));

    expect(screen.getByText(PROTECTED_GLOBS_LABEL)).toBeTruthy();
    expect(screen.getByLabelText("stub glob input")).toHaveProperty("id", controlId("pp", "globs"));
    expect(screen.getByTestId("glob-editor").dataset.readOnly).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "stub add" }));
    fireEvent.click(screen.getByRole("button", { name: "stub preview" }));

    expect(calls).toEqual([{ globs: ["boot/**", "drivers/**"] }]);
    expect(screen.getByTestId("globs").textContent).toBe("boot/**,drivers/**");
    expect(previewPaths).toHaveBeenCalledWith(["boot/**", "drivers/**"]);
  });
});

describe("spend_guard", () => {
  /**
   * Mount the editor.
   *
   * @param terms The terms to start from.
   * @param readOnly Whether it is inert.
   * @returns The emissions.
   */
  function draw(terms: SpendGuardTerms, readOnly = false): Emitted<SpendGuardTerms> {
    return mount(terms, (now, onChange) => (
      <SpendGuardEditor idBase="sg" onChange={onChange} readOnly={readOnly} terms={now} />
    ));
  }

  it("shows each cap in dollars with its currency, and says what each does today", () => {
    draw({ perRunCents: 250, monthlyCents: 60_000 });

    expect(screen.getByLabelText(PER_RUN_LABEL)).toHaveProperty("value", "2.50");
    expect(screen.getByLabelText(MONTHLY_LABEL)).toHaveProperty("value", "600");
    expect(screen.getByLabelText(PER_RUN_LABEL)).toHaveProperty("id", controlId("sg", "per-run"));
    expect(screen.getByLabelText(MONTHLY_LABEL)).toHaveProperty("id", controlId("sg", "monthly"));
    expect(screen.getAllByText("$")).toHaveLength(2);
    expect(screen.getByText(PER_RUN_HINT)).toBeTruthy();
    expect(MONTHLY_HINT).toContain("#237");
    expect(PER_RUN_HINT).toContain("stricter");
  });

  it("emits integer cents with no drift, only for a complete amount", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: 60_000 });
    const field = screen.getByLabelText(PER_RUN_LABEL);

    for (const text of ["1", "19", "19.", "19.9", "19.99"]) type(field, text);

    expect(calls.map((terms) => terms.perRunCents)).toEqual([100, 1900, 1990, 1999]);
    expect(calls.every((terms) => Number.isInteger(terms.perRunCents))).toBe(true);
    expect(calls.every((terms) => terms.monthlyCents === 60_000)).toBe(true);
  });

  it("never lets a letter or a third decimal into the field", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: null });
    const field = screen.getByLabelText(PER_RUN_LABEL);

    type(field, "2.505");
    type(field, "2.5a");
    type(field, "-2");
    type(field, "1e3");

    expect(field).toHaveProperty("value", "2.50");
    expect(calls).toEqual([]);
  });

  it("lets a cap be emptied while the other stands", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: 60_000 });

    type(screen.getByLabelText(MONTHLY_LABEL), "");

    expect(calls).toEqual([{ perRunCents: 250, monthlyCents: null }]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the last cap: emptying it emits nothing, says why, and leaving restores it", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: null });
    const field = screen.getByLabelText(PER_RUN_LABEL);

    type(field, "");

    expect(calls).toEqual([]);
    expect(screen.getByRole("alert").textContent).toBe(NEEDS_A_CAP);
    expect(field.getAttribute("aria-invalid")).toBe("true");

    fireEvent.blur(field);

    expect(field).toHaveProperty("value", "2.50");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses zero: nothing is emitted, the field says so, and leaving restores the amount", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: 60_000 });
    const field = screen.getByLabelText(PER_RUN_LABEL);

    type(field, "0");
    expect(screen.getByRole("alert").textContent).toBe(AMOUNT_TOO_SMALL);
    type(field, "0.00");
    expect(screen.getByRole("alert").textContent).toBe(AMOUNT_TOO_SMALL);

    fireEvent.blur(field);

    expect(calls).toEqual([]);
    expect(field).toHaveProperty("value", "2.50");
  });

  it("restores an unfinished amount on leaving, and keeps a finished one as typed", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: 60_000 });
    const field = screen.getByLabelText(PER_RUN_LABEL);

    type(field, "3.");
    fireEvent.blur(field);
    expect(field).toHaveProperty("value", "2.50");

    type(field, "3");
    fireEvent.blur(field);
    expect(field).toHaveProperty("value", "3");
    expect(calls).toEqual([{ perRunCents: 300, monthlyCents: 60_000 }]);
  });

  it("takes the amount the draft holds when it moves underneath the field", () => {
    function Harness() {
      const [terms, setTerms] = useState<SpendGuardTerms>({ perRunCents: 250, monthlyCents: 60_000 });

      return (
        <>
          <SpendGuardEditor idBase="sg" onChange={setTerms} readOnly={false} terms={terms} />
          <button
            onClick={() => {
              setTerms({ perRunCents: 999, monthlyCents: null });
            }}
            type="button"
          >
            discard
          </button>
        </>
      );
    }

    render(<Harness />);
    type(screen.getByLabelText(PER_RUN_LABEL), "7");
    fireEvent.click(screen.getByRole("button", { name: "discard" }));

    expect(screen.getByLabelText(PER_RUN_LABEL)).toHaveProperty("value", "9.99");
    expect(screen.getByLabelText(MONTHLY_LABEL)).toHaveProperty("value", "");
  });

  it("is inert while a save is in flight", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: 60_000 }, true);
    const field = screen.getByLabelText(PER_RUN_LABEL);

    expect(field).toHaveProperty("readOnly", true);
    type(field, "9");

    expect(calls).toEqual([]);
    expect(field).toHaveProperty("value", "2.50");
  });

  it("only ever emits a draft the document admits", () => {
    const { calls } = draw({ perRunCents: 250, monthlyCents: 60_000 });

    type(screen.getByLabelText(PER_RUN_LABEL), "");
    type(screen.getByLabelText(MONTHLY_LABEL), "");
    type(screen.getByLabelText(MONTHLY_LABEL), "0");
    type(screen.getByLabelText(MONTHLY_LABEL), "12.3");

    expect(calls).toEqual([
      { perRunCents: null, monthlyCents: 60_000 },
      { perRunCents: null, monthlyCents: 1230 },
    ]);
    for (const terms of calls) {
      expect(terms.perRunCents !== null || terms.monthlyCents !== null).toBe(true);
    }
  });
});

describe("dry_run_new_repos", () => {
  /**
   * Mount the editor.
   *
   * @param firstLoops The count to start from.
   * @param readOnly Whether it is inert.
   * @returns The emissions.
   */
  function draw(firstLoops: number, readOnly = false): Emitted<DryRunTerms> {
    return mount<DryRunTerms>({ firstLoops }, (now, onChange) => (
      <DryRunEditor idBase="dr" onChange={onChange} readOnly={readOnly} terms={now} />
    ));
  }

  it("steps by one and spells the consequence out for the count as it stands", () => {
    const { calls } = draw(10);
    const field = screen.getByLabelText(LOOPS_LABEL);

    expect(field).toHaveProperty("id", controlId("dr", "loops"));
    expect(screen.getByText(loopsConsequence(10))).toBeTruthy();
    expect(loopsConsequence(10)).toBe(
      "A new repository's first 10 loops open draft PRs; nothing of theirs merges on its own until then.",
    );

    fireEvent.click(screen.getByRole("button", { name: ONE_MORE }));
    fireEvent.click(screen.getByRole("button", { name: ONE_FEWER }));
    fireEvent.click(screen.getByRole("button", { name: ONE_FEWER }));

    expect(calls).toEqual([{ firstLoops: 11 }, { firstLoops: 10 }, { firstLoops: 9 }]);
    expect(field).toHaveProperty("value", "9");
    expect(screen.getByText(loopsConsequence(9))).toBeTruthy();
  });

  it("stops at zero and says the rule then holds nothing back", () => {
    const { calls } = draw(1);

    expect(screen.getByText(loopsConsequence(1))).toBeTruthy();
    expect(loopsConsequence(1)).toContain("first loop opens a draft PR");

    fireEvent.click(screen.getByRole("button", { name: ONE_FEWER }));
    fireEvent.click(screen.getByRole("button", { name: ONE_FEWER }));

    expect(calls).toEqual([{ firstLoops: 0 }]);
    expect(screen.getByText(loopsConsequence(0))).toBeTruthy();
    expect(loopsConsequence(0)).toContain("No loops are held as drafts");
    expect(screen.getByRole("button", { name: ONE_FEWER }).getAttribute("aria-disabled")).toBe("true");
  });

  it("stops at the grammar's ceiling", () => {
    const { calls } = draw(LOOPS_MAX);

    fireEvent.click(screen.getByRole("button", { name: ONE_MORE }));

    expect(calls).toEqual([]);
    expect(screen.getByRole("button", { name: ONE_MORE }).getAttribute("aria-disabled")).toBe("true");
  });

  it("takes digits only, clamps what is typed, and never emits a fraction", () => {
    const { calls } = draw(10);
    const field = screen.getByLabelText(LOOPS_LABEL);

    type(field, "1.5");
    type(field, "-3");
    type(field, "1e2");
    type(field, "1234567");
    expect(field).toHaveProperty("value", "10");

    type(field, "25");
    type(field, "999999");

    expect(calls).toEqual([{ firstLoops: 25 }, { firstLoops: LOOPS_MAX }]);
    expect(calls.every((terms) => Number.isInteger(terms.firstLoops))).toBe(true);

    fireEvent.blur(field);
    expect(field).toHaveProperty("value", String(LOOPS_MAX));
  });

  it("keeps the count while the field is empty, and restores it on leaving", () => {
    const { calls } = draw(10);
    const field = screen.getByLabelText(LOOPS_LABEL);

    type(field, "");
    expect(calls).toEqual([]);
    expect(screen.getByText(loopsConsequence(10))).toBeTruthy();

    fireEvent.blur(field);
    expect(field).toHaveProperty("value", "10");
  });

  it("is inert while a save is in flight", () => {
    const { calls } = draw(10, true);

    fireEvent.click(screen.getByRole("button", { name: ONE_MORE }));
    type(screen.getByLabelText(LOOPS_LABEL), "3");

    expect(calls).toEqual([]);
    expect(screen.getByLabelText(LOOPS_LABEL)).toHaveProperty("value", "10");
  });
});

describe("every editor, together", () => {
  it("leaves a draft that passes the card's last check after a run of edits", () => {
    const auto = mount<AutoMergeTerms>({ maxEffort: "m", excludedLabels: ["refactor"] }, (now, onChange) => (
      <AutoMergeEditor idBase="am" onChange={onChange} readOnly={false} terms={now} />
    ));

    fireEvent.change(screen.getByLabelText(AUTO_MERGE_EFFORT_LABEL), { target: { value: "" } });

    const last = auto.calls[auto.calls.length - 1];

    expect(
      validatePolicy({
        auto_merge: { enabled: true, terms: last },
        human_review: { enabled: true, terms: { labels: ["a"], minEffort: null } },
        protected_paths: { enabled: true, terms: { globs: [] } },
        spend_guard: { enabled: true, terms: { perRunCents: 1, monthlyCents: null } },
        dry_run_new_repos: { enabled: true, terms: { firstLoops: 0 } },
      }),
    ).toEqual({});
  });
});
