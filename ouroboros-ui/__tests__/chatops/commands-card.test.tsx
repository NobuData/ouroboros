import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ConsoleCommand } from "@/app/api/console";
import { CommandsCard } from "@/app/chatops/commands-card";
import { COMMANDS_CAPTION, COMMANDS_EMPTY, COMMANDS_UNREAD, TEAMS_QUALIFIER } from "@/app/chatops/view";

import { EXPLAIN_UNAVAILABLE, commands, grammar } from "../helpers/console";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The commands card (#543): every row is a command of the grammar it was handed — one more in
 * the grammar is one more row, one fewer is one fewer — a denied command is dimmed with its
 * reason, a staged one carries its chip and no way to run it, and **Try it** hands the composer
 * a skeleton without sending anything.
 */

/**
 * The card on a grammar.
 *
 * @param list The grammar's commands.
 * @param onTry The composer's prefill, or none.
 * @returns The element.
 */
function Commands(list: ConsoleCommand[] = commands(), onTry?: (line: string) => void) {
  return <CommandsCard grammar={{ ok: true, value: grammar({ commands: list }) }} onTry={onTry} titleId="commands" />;
}

/** The rows, in order. */
function rows(): HTMLElement[] {
  return within(screen.getByRole("group", { name: "Command list" })).getAllByRole("listitem");
}

/**
 * The row of one command.
 *
 * @param code Its code form.
 * @returns The row.
 */
function row(code: string): HTMLElement {
  return rows().find((one) => one.querySelector("code")?.textContent === code)!;
}

/** A command no registry has — proof the card writes none of its rows. */
const INVENTED: ConsoleCommand = {
  ...commands()[0]!,
  id: "defrost",
  usage: "defrost #77 [gently]",
  syntax: "/ouro defrost <ticket> [gently]",
  summary: "thaw a frozen ticket, a sentence nobody wrote in the UI",
  arguments: [
    { name: "ticket", type: "ticket", optional: false, description: "", completion: "tickets" },
    { name: "gently", type: "keyword", optional: true, description: "", completion: null },
  ],
};

describe("the rows", () => {
  it("are the grammar's commands, in the grammar's order, under the mockup's title", () => {
    render(Commands());

    expect(screen.getByRole("region", { name: "COMMANDS" })).toBeInTheDocument();
    expect(rows().map((one) => one.querySelector("code")!.textContent)).toEqual(
      commands().map((command) => `/ouro ${command.usage}`),
    );
    for (const command of commands()) expect(screen.getByText(command.summary)).toBeInTheDocument();
  });

  it("gain a row when the grammar gains a command, verbatim, and lose one when it loses one", () => {
    render(Commands([...commands(), INVENTED]));

    const added = row("/ouro defrost #77 [gently]");

    expect(added).toHaveTextContent("thaw a frozen ticket, a sentence nobody wrote in the UI");
    expect(rows()).toHaveLength(commands().length + 1);
    cleanup();

    render(Commands(commands().filter((command) => command.id !== "status")));

    expect(rows()).toHaveLength(commands().length - 1);
    expect(screen.queryByText("everything live, in one line")).toBeNull();
  });

  it("dim the words the grammar marks optional, and no others", () => {
    render(Commands([...commands(), INVENTED]));

    const hints = (code: string) => [...row(code).querySelectorAll(".chatops-side__cmd-arg")].map((one) => one.textContent);

    expect(hints("/ouro queue #485 [workflow]")).toEqual([" [workflow]"]);
    expect(hints("/ouro defrost #77 [gently]")).toEqual([" [gently]"]);
    expect(hints("/ouro status")).toEqual([]);
  });

  it("are written nowhere in the card or the page's copy", () => {
    const source = ["commands-card.tsx", "view.ts"]
      .map((name) => readFileSync(join(import.meta.dirname, "..", "..", "app", "chatops", name), "utf8"))
      .join("\n");

    for (const command of commands()) {
      expect(source, command.summary).not.toContain(command.summary);
      if (command.arguments.length > 0) expect(source, command.usage).not.toContain(command.usage);
    }
    for (const sentence of ["the big red button", "repin a stage's model", "rehearse with no writes"]) {
      expect(source).not.toContain(sentence);
    }
  });
});

describe("a command the reader may not run", () => {
  it("is dimmed, not hidden, with what is missing said under it — and offers no Try it", () => {
    render(Commands(commands(), vi.fn()));

    const denied = row("/ouro pause loop 1847");

    expect(denied).toHaveClass("chatops-side__cmd--denied");
    expect(denied).toHaveTextContent("Not available to you — needs admin");
    expect(within(denied).queryByRole("button", { name: /^Try / })).toBeNull();
    expect(row("/ouro status")).not.toHaveClass("chatops-side__cmd--denied");
  });
});

describe("a command that is not runnable yet", () => {
  it("carries its stage chip naming the issue it waits for, the grammar's note behind it, and no Try it", () => {
    render(Commands(commands(), vi.fn()));

    const staged = row("/ouro explain pr 514");

    expect(within(staged).getByText("v2 · #546")).toHaveClass("ou-tag");
    expect(within(staged).queryByRole("button", { name: /^Try / })).toBeNull();

    const tip = within(staged).getByRole("button", { name: "Why /ouro explain pr cannot be run yet" });

    expect(tip).toHaveAccessibleDescription(EXPLAIN_UNAVAILABLE);
  });

  it("shows the note in words when it names no issue for the chip", () => {
    const vague = { ...commands().find((one) => one.id === "explain pr")!, unavailableReply: "Not in this release." };

    render(Commands([vague]));

    expect(within(rows()[0]!).getByText("v2")).toHaveClass("ou-tag");
    expect(rows()[0]!).toHaveTextContent("Not in this release.");
  });
});

describe("Try it", () => {
  it("hands the composer the prefix, the command's name and a space", () => {
    const onTry = vi.fn();

    render(Commands(commands(), onTry));

    fireEvent.click(within(row("/ouro queue #485 [workflow]")).getByRole("button", { name: "Try /ouro queue in the composer" }));
    fireEvent.click(within(row("/ouro abort loop 1847")).getByRole("button", { name: /^Try / }));

    expect(onTry.mock.calls).toEqual([["/ouro queue "], ["/ouro abort loop "]]);
    expect(screen.getAllByRole("button", { name: /^Try / })[0]).toHaveTextContent("Try it");
  });

  it("is absent when the page has no composer", () => {
    render(Commands());

    expect(screen.queryByRole("button", { name: /^Try / })).toBeNull();
    expect(rows()).toHaveLength(commands().length);
  });
});

describe("the caption", () => {
  it("is the mockup's, with Teams visibly qualified", () => {
    render(Commands());

    const caption = screen.getByText(COMMANDS_CAPTION, { exact: false, selector: ".chatops-side__caption" });

    expect(caption).toHaveTextContent("Identical in Slack, Teams, and the in-app console. Tab-completion everywhere.");
    expect(within(caption).getByText(TEAMS_QUALIFIER)).toHaveTextContent("Teams arrives with #547");
  });
});

describe("the card's own states", () => {
  it("says the grammar could not be read, with the service's reason, and keeps the caption", () => {
    render(<CommandsCard grammar={{ ok: false, reason: "The grammar could not be loaded." }} titleId="commands" />);

    expect(screen.getByText(COMMANDS_UNREAD)).toBeInTheDocument();
    expect(screen.getByText("The grammar could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Command list" })).toBeNull();
    expect(screen.getByText(TEAMS_QUALIFIER)).toBeInTheDocument();
  });

  it("says so when the grammar lists nothing", () => {
    render(Commands([]));

    expect(screen.getByText(COMMANDS_EMPTY)).toBeInTheDocument();
  });

  it("scrolls inside a region a keyboard can reach", () => {
    render(Commands());

    const list = screen.getByRole("group", { name: "Command list" });

    expect(list).toHaveClass("chatops-side__cmd-scroll");
    expect(list).toHaveAttribute("tabindex", "0");
  });

  it("renders the same markup in both palettes", () => {
    const [light, dark] = renderInBothPalettes(Commands(commands(), vi.fn()));
    cleanup();

    expect(maskIds(light!)).toBe(maskIds(dark!));
  });
});
