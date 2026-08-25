import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADD_RULE,
  DELETE_RULE,
  DELETE_TITLE,
  NO_RULES_TITLE,
  RULE_FORBIDDEN,
  RULE_OFF,
  RULES_TITLE,
} from "@/app/models/rules";

import { seededRules, seededTaskKinds } from "../helpers/models";
import { PALETTES, renderInBothPalettes } from "../helpers/palettes";

/**
 * The rules card as it is drawn (#204) — mockup 06's three switchable sentences, and the two
 * controls a role that may change them is given.
 *
 * What every row *says* is `rules.test.ts`'s. What is here is what only a render can show:
 * that the sentences come out as the server wrote them with the alias in its own run, that a
 * switch moves on the press and goes back when the write does not land, that a delete asks
 * first, and that a member is shown the rules and nothing that looks like a control.
 *
 * What the actions do is `rule-actions.test.ts`'s; they are replaced here, because a suite
 * that drove the real ones would be testing the API client through a switch.
 */

/** What the writes answer, per case. */
const setRuleEnabled = vi.fn();
const removeRule = vi.fn();

/** What tells the server's own render that a rule moved. */
const refresh = vi.fn();

vi.mock("@/app/models/rule-actions", () => ({
  setRuleEnabled: (id: string, enabled: boolean) => setRuleEnabled(id, enabled),
  removeRule: (id: string) => removeRule(id),
  addRule: vi.fn(),
  readRuleTargets: vi.fn().mockResolvedValue({ ok: true, aliases: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const { RulesCard } = await import("@/app/models/rules-card");

/** The seeded kinds, as the builder is handed them. */
const KINDS = seededTaskKinds().map((kind) => kind.name);

/**
 * The card, for an owner unless the case says otherwise.
 *
 * @param props What this case is about.
 * @returns The rendered card.
 */
function card(props: { rules?: ReturnType<typeof seededRules>; mayAdminister?: boolean } = {}) {
  return render(
    <RulesCard
      mayAdminister={props.mayAdminister ?? true}
      rules={props.rules ?? seededRules()}
      taskKinds={KINDS}
    />,
  );
}

/**
 * A write this suite finishes itself, for the cases about the window before the answer.
 *
 * A never-settling promise would hold up every transition after it — React entangles async
 * transitions — so every case that opens one closes it.
 *
 * @returns The promise to answer the write with, and the function that answers it.
 */
function deferredWrite(): {
  promise: Promise<{ ok: boolean; reason?: string }>;
  answer: (result: { ok: boolean; reason?: string }) => void;
} {
  let answer!: (result: { ok: boolean; reason?: string }) => void;
  const promise = new Promise<{ ok: boolean; reason?: string }>((resolve) => {
    answer = resolve;
  });

  return { promise, answer };
}

beforeEach(() => {
  setRuleEnabled.mockReset().mockResolvedValue({ ok: true });
  removeRule.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

describe("the seeded card", () => {
  it("is a named region carrying the mockup's count", () => {
    card();

    const region = screen.getByRole("region", { name: RULES_TITLE });

    expect(within(region).getByText("3 active")).toBeInTheDocument();
  });

  it("prints the three sentences exactly as the server wrote them", () => {
    card();

    const sentences = [...document.querySelectorAll(".models-rules__sentence")].map(
      (sentence) => sentence.textContent,
    );

    expect(sentences).toEqual(seededRules().map((rule) => rule.display));
  });

  it("draws the alias in its own run, and the route_local sentence in one piece", () => {
    card();

    const aliases = [...document.querySelectorAll(".models-rules__alias")].map(
      (alias) => alias.textContent,
    );

    expect(aliases).toEqual(["coder-max", "second-opinion"]);
  });

  it("counts the enabled rules rather than the rows", () => {
    card({ rules: seededRules().map((rule, index) => ({ ...rule, enabled: index !== 2 })) });

    expect(screen.getByText("2 active")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("recedes a rule whose switch is off, and keeps its row", () => {
    card({ rules: seededRules().map((rule, index) => ({ ...rule, enabled: index !== 0 })) });

    const rows = screen.getAllByRole("listitem");

    expect(rows[0]).toHaveClass("models-rules__row--off");
    expect(rows[1]).not.toHaveClass("models-rules__row--off");
  });
});

describe("an administrator's switch", () => {
  it("is named by what it decides and which rule it is for, and reports its position", () => {
    card();

    const switches = screen.getAllByRole("switch");

    expect(switches.map((control) => control.getAttribute("aria-checked"))).toEqual([
      "true",
      "true",
      "true",
    ]);
    expect(
      screen.getByRole("switch", { name: "Apply docs-only diff → everything routes local" }),
    ).toBeInTheDocument();
  });

  it("moves before the server has answered", async () => {
    const write = deferredWrite();
    setRuleEnabled.mockReturnValue(write.promise);
    card();

    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");

    write.answer({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("sends the rule's id and the position to move to", async () => {
    card();

    fireEvent.click(screen.getAllByRole("switch")[1]);

    await waitFor(() =>
      expect(setRuleEnabled).toHaveBeenCalledExactlyOnceWith(seededRules()[1].id, false),
    );
  });

  it("asks the server to re-render the page once the write has landed, so the count follows the read", async () => {
    card();

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    // The count is a fact about the server's rules, not this browser's switches: it moves
    // when the fresh read arrives, and not before.
    expect(screen.getByText("3 active")).toBeInTheDocument();
  });

  it("ignores a second press while the first is still in flight", async () => {
    const write = deferredWrite();
    setRuleEnabled.mockReturnValue(write.promise);
    card();

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(setRuleEnabled).toHaveBeenCalledOnce();

    write.answer({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it("goes back where the server still has it when the write did not land, and says why", async () => {
    setRuleEnabled.mockResolvedValue({ ok: false, reason: RULE_FORBIDDEN });
    card();

    fireEvent.click(screen.getAllByRole("switch")[0]);

    const note = await screen.findByRole("alert");

    expect(note).toHaveTextContent(RULE_FORBIDDEN);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-describedby", note.id);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("clears the last failure on the next press", async () => {
    setRuleEnabled.mockResolvedValueOnce({ ok: false, reason: "Nope." });
    card();

    fireEvent.click(screen.getAllByRole("switch")[0]);
    await screen.findByRole("alert");

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});

describe("an administrator's delete", () => {
  it("asks first, naming the rule, and does nothing until answered", () => {
    card();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete rule:/ })[1]);

    const dialog = screen.getByRole("dialog", { name: DELETE_TITLE });

    expect(within(dialog).getByText(seededRules()[1].display)).toBeInTheDocument();
    expect(within(dialog).getByText(/switch it off instead/)).toBeInTheDocument();
    expect(removeRule).not.toHaveBeenCalled();
  });

  it("removes the rule and re-renders the page when the confirmation is answered", async () => {
    card();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete rule:/ })[2]);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: DELETE_RULE }),
    );

    await waitFor(() => expect(removeRule).toHaveBeenCalledExactlyOnceWith(seededRules()[2].id));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does nothing when the confirmation is cancelled", () => {
    card();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete rule:/ })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(removeRule).not.toHaveBeenCalled();
  });

  it("closes on Escape without removing anything", () => {
    card();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete rule:/ })[0]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(removeRule).not.toHaveBeenCalled();
  });

  it("leaves the row and says why when the delete did not land", async () => {
    removeRule.mockResolvedValue({ ok: false, reason: "Gone already." });
    card();

    fireEvent.click(screen.getAllByRole("button", { name: /^Delete rule:/ })[0]);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: DELETE_RULE }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Gone already.");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a member", () => {
  it("sees the rules and the count, and nothing that looks like a control", () => {
    card({ mayAdminister: false });

    expect(screen.getByText("3 active")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ADD_RULE })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete rule:/ })).not.toBeInTheDocument();
    // Absent, not disabled: nothing on the card carries aria-disabled either.
    expect(document.querySelector("[aria-disabled]")).toBeNull();
  });

  it("is told in a word which rule is off, since there is no switch to read it from", () => {
    card({
      mayAdminister: false,
      rules: seededRules().map((rule, index) => ({ ...rule, enabled: index !== 1 })),
    });

    const rows = screen.getAllByRole("listitem");

    expect(within(rows[1]).getByText(RULE_OFF)).toBeInTheDocument();
    expect(within(rows[0]).queryByText(RULE_OFF)).not.toBeInTheDocument();
  });
});

describe("a workspace with no rules", () => {
  it("gets the empty state, and an administrator still gets the builder", () => {
    card({ rules: [] });

    expect(screen.getByText(NO_RULES_TITLE)).toBeInTheDocument();
    expect(screen.getByText("0 active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD_RULE })).toBeInTheDocument();
  });

  it("gets the empty state and nothing to press, for a member", () => {
    card({ rules: [], mayAdminister: false });

    expect(screen.getByText(NO_RULES_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the palettes", () => {
  it("renders the same markup under both", () => {
    const [light, dark] = renderInBothPalettes(
      <RulesCard mayAdminister rules={seededRules()} taskKinds={KINDS} />,
    );

    expect(light).toBe(dark);
    expect(PALETTES).toHaveLength(2);
  });
});
