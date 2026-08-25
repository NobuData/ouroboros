import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADD_RULE,
  BUILDER_TITLE,
  LABEL_REQUIRED,
  NO_TASK_KINDS,
  SAVE_RULE,
  TARGETS_LOADING,
  TARGETS_UNAVAILABLE,
  ruleTarget,
} from "@/app/models/rules";

import { seededAliases, seededRules, seededTaskKinds } from "../helpers/models";
import { settle } from "../helpers/settle";

/**
 * The **+ Add rule** builder as it is drawn (#204).
 *
 * The acceptance criterion this suite exists for: **the builder can produce only valid M5
 * structures, and there is no free-text rule path.** What a draft composes to is
 * `rules.test.ts`'s; what is here is that the dialog drives that composer from selects, that
 * what reaches the action is structure and never a sentence, that the registry is read in the
 * press that opens the dialog, and that a refusal keeps the dialog open with the reason.
 */

/** What the action answers, per case. */
const addRule = vi.fn();
const readRuleTargets = vi.fn();

/** What tells the server's own render that a rule was added. */
const refresh = vi.fn();

vi.mock("@/app/models/rule-actions", () => ({
  addRule: (rule: unknown) => addRule(rule),
  readRuleTargets: () => readRuleTargets(),
  setRuleEnabled: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RuleBuilder } = await import("@/app/models/rule-builder");

/** The seeded kinds, as the builder is handed them. */
const KINDS = seededTaskKinds().map((kind) => kind.name);

/** The registry, as the action answers it. */
const TARGETS = { ok: true, aliases: seededAliases().map(ruleTarget) };

/**
 * Open the builder and wait for the registry to arrive.
 *
 * @param kinds The workspace's task kinds.
 * @returns The dialog.
 */
async function openBuilder(kinds: readonly string[] = KINDS): Promise<HTMLElement> {
  render(<RuleBuilder taskKinds={kinds} />);

  fireEvent.click(screen.getByRole("button", { name: ADD_RULE }));

  const dialog = screen.getByRole("dialog", { name: BUILDER_TITLE });
  await within(dialog).findByLabelText("Alias");
  // The alias field is the read's *output*; the read's transition may still be pending for a
  // turn, and the builder drops a save pressed while it is (`../helpers/settle.ts`).
  await settle();

  return dialog;
}

/**
 * Choose an option in one of the dialog's selects.
 *
 * @param dialog The dialog.
 * @param label The select's label.
 * @param value The option's value.
 */
function choose(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  addRule.mockReset().mockResolvedValue({ ok: true });
  readRuleTargets.mockReset().mockResolvedValue(TARGETS);
  refresh.mockReset();
});

describe("opening", () => {
  it("reads the registry in the press that opens the dialog, and says so until it arrives", async () => {
    render(<RuleBuilder taskKinds={KINDS} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(readRuleTargets).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: ADD_RULE }));

    const dialog = screen.getByRole("dialog", { name: BUILDER_TITLE });

    expect(readRuleTargets).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("status")).toHaveTextContent(TARGETS_LOADING);
    expect(within(dialog).getByRole("button", { name: SAVE_RULE })).toHaveAttribute(
      "title",
      TARGETS_LOADING,
    );

    await within(dialog).findByLabelText("Alias");
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
  });

  it("opens on mockup 06's own first rule, with the workspace's first kind and alias", async () => {
    const dialog = await openBuilder();

    expect(within(dialog).getByLabelText("Condition")).toHaveValue("effort_gte");
    expect(within(dialog).getByLabelText("Effort")).toHaveValue("l");
    expect(within(dialog).getByLabelText("Action")).toHaveValue("use_alias");
    expect(within(dialog).getByLabelText("Task kind")).toHaveValue("analyze");
    expect(within(dialog).getByLabelText("Alias")).toHaveValue("coder-fallback");
    expect(within(dialog).getByLabelText("Thinking")).toHaveValue("max");
  });

  it("offers every alias the registry holds, each with what it resolves to", async () => {
    const dialog = await openBuilder();

    const options = [...within(dialog).getByLabelText("Alias").querySelectorAll("option")];

    expect(options.map((option) => option.value)).toEqual(seededAliases().map((a) => a.alias));
    expect(options[1]).toHaveTextContent("coder-max — claude-fable-5 · Anthropic Claude");
    expect(options[3]).toHaveTextContent("gpt5-experiments — gpt-5 · no provider");
  });

  it("offers every task kind the matrix has, in its order", async () => {
    const dialog = await openBuilder();

    const options = [...within(dialog).getByLabelText("Task kind").querySelectorAll("option")];

    expect(options.map((option) => option.value)).toEqual(KINDS);
  });

  it("says why there is no text box", async () => {
    const dialog = await openBuilder();

    expect(within(dialog).getByText(/nothing to type/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("saving", () => {
  it("sends the seed's first rule from the opening draft, as structure and with no sentence", async () => {
    const dialog = await openBuilder();

    choose(dialog, "Task kind", "implement");
    choose(dialog, "Alias", "coder-max");
    fireEvent.click(within(dialog).getByRole("button", { name: SAVE_RULE }));

    await waitFor(() => expect(addRule).toHaveBeenCalledOnce());

    const sent: unknown = addRule.mock.calls[0][0];

    expect(sent).toEqual({ when: seededRules()[0].when, then: seededRules()[0].then });
    expect(Object.keys(sent as object)).toEqual(["when", "then"]);
    expect(JSON.stringify(sent)).not.toContain("display");
  });

  it("closes and asks the server to re-render the page once the write has landed", async () => {
    const dialog = await openBuilder();

    fireEvent.click(within(dialog).getByRole("button", { name: SAVE_RULE }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("composes the seed's add_vote rule when the action says so, and offers no thinking for it", async () => {
    const dialog = await openBuilder();

    choose(dialog, "Condition", "label");
    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "security" } });
    choose(dialog, "Action", "add_vote");
    choose(dialog, "Task kind", "review");
    choose(dialog, "Alias", "second-opinion");

    expect(within(dialog).queryByLabelText("Thinking")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: SAVE_RULE }));

    await waitFor(() =>
      expect(addRule).toHaveBeenCalledExactlyOnceWith({
        when: seededRules()[1].when,
        then: seededRules()[1].then,
      }),
    );
  });

  it("composes the seed's route_local rule, and asks for no target at all", async () => {
    const dialog = await openBuilder();

    choose(dialog, "Condition", "diff_kind");
    choose(dialog, "Action", "route_local");

    expect(within(dialog).queryByLabelText("Task kind")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Alias")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Thinking")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: SAVE_RULE }));

    await waitFor(() =>
      expect(addRule).toHaveBeenCalledExactlyOnceWith({
        when: seededRules()[2].when,
        then: seededRules()[2].then,
      }),
    );
  });

  it("sends no params when the alias's own thinking is to stand", async () => {
    const dialog = await openBuilder();

    choose(dialog, "Thinking", "inherit");
    fireEvent.click(within(dialog).getByRole("button", { name: SAVE_RULE }));

    await waitFor(() => expect(addRule).toHaveBeenCalledOnce());
    expect(addRule.mock.calls[0][0].then.use_alias).toEqual({
      task_kind: "analyze",
      alias: "coder-fallback",
    });
  });

  it("stays open with the server's reason when the write was refused, keeping the draft", async () => {
    addRule.mockResolvedValue({ ok: false, reason: "then: names an alias this workspace does not have." });
    const dialog = await openBuilder();

    choose(dialog, "Task kind", "docs");
    fireEvent.click(within(dialog).getByRole("button", { name: SAVE_RULE }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/names an alias/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Task kind")).toHaveValue("docs");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("what cannot be saved", () => {
  it("is inert with the reason while a label predicate has no label, and wakes when it has one", async () => {
    const dialog = await openBuilder();

    choose(dialog, "Condition", "label");

    const save = within(dialog).getByRole("button", { name: SAVE_RULE });

    // The label is the one typed value, and it is an operand, not a sentence.
    expect(within(dialog).getByRole("textbox", { name: "Label" })).toBeInTheDocument();
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("title", LABEL_REQUIRED);

    fireEvent.click(save);
    expect(addRule).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("Label"), { target: { value: "security" } });

    expect(within(dialog).getByRole("button", { name: SAVE_RULE })).not.toHaveAttribute("aria-disabled");
  });

  it("is inert with the reason for a workspace with no task kinds, and still allows route_local", async () => {
    const dialog = await openBuilder([]);

    const save = within(dialog).getByRole("button", { name: SAVE_RULE });

    expect(save).toHaveAttribute("title", NO_TASK_KINDS);

    choose(dialog, "Action", "route_local");

    expect(within(dialog).getByRole("button", { name: SAVE_RULE })).not.toHaveAttribute("aria-disabled");
  });

  it("carries the registry's refusal as the reason, and still allows route_local", async () => {
    readRuleTargets.mockResolvedValue({ ok: false, reason: TARGETS_UNAVAILABLE });
    render(<RuleBuilder taskKinds={KINDS} />);

    fireEvent.click(screen.getByRole("button", { name: ADD_RULE }));

    const dialog = screen.getByRole("dialog", { name: BUILDER_TITLE });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(TARGETS_UNAVAILABLE);
    expect(within(dialog).getByRole("button", { name: SAVE_RULE })).toHaveAttribute(
      "title",
      TARGETS_UNAVAILABLE,
    );

    choose(dialog, "Action", "route_local");

    expect(within(dialog).getByRole("button", { name: SAVE_RULE })).not.toHaveAttribute("aria-disabled");
  });
});

describe("closing", () => {
  it("closes on Cancel without writing", async () => {
    const dialog = await openBuilder();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(addRule).not.toHaveBeenCalled();
  });

  it("closes on Escape without writing", async () => {
    const dialog = await openBuilder();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(addRule).not.toHaveBeenCalled();
  });

  it("starts from the seed's rule again on the next open, not from the discarded draft", async () => {
    const dialog = await openBuilder();

    choose(dialog, "Action", "route_local");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: ADD_RULE }));

    const reopened = screen.getByRole("dialog", { name: BUILDER_TITLE });

    expect(within(reopened).getByLabelText("Action")).toHaveValue("use_alias");
    expect(readRuleTargets).toHaveBeenCalledTimes(2);
    await within(reopened).findByLabelText("Alias");
  });
});
