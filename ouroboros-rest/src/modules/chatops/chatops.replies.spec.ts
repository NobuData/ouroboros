import { CHAT_REPLIES, deniedText, fill } from "./chatops.replies";
import { requirementWords } from "./grammar.help";
import { GRAMMAR, commandOf } from "./grammar.registry";
import type { CommandDefinition } from "./grammar.types";

/**
 * The sentences the dispatcher says itself (#537): a refusal names what the command takes, a
 * confirm prompt is filled from what was typed, and a failure never carries its details.
 */

/**
 * A command of the real grammar.
 *
 * @param name - Its id or an alias.
 * @returns The definition; the test fails when the registry has no such command.
 */
function registered(name: string): CommandDefinition {
  const definition = commandOf(GRAMMAR, name);

  if (definition === undefined) {
    throw new Error(`the registry has no "${name}"`);
  }

  return definition;
}

describe("deniedText", () => {
  it("names the roles the command is for", () => {
    expect(deniedText(registered("route"))).toBe(
      "`/ouro route` is for workspace owners and admins.",
    );
    expect(deniedText(registered("queue"))).toBe(
      "`/ouro queue` is for workspace owners, admins and members.",
    );
  });

  it("names a command of two words whole", () => {
    expect(deniedText(registered("pause all"))).toBe(
      "`/ouro pause all` is for workspace owners and admins.",
    );
  });

  it("names the command by its id, whichever alias was typed", () => {
    expect(deniedText(registered("dryrun"))).toBe(
      "`/ouro dry-run` is for workspace owners, admins and members.",
    );
  });

  it("names the capability a command takes, beside the roles or alone", () => {
    const approve: CommandDefinition = {
      ...registered("status"),
      id: "approve",
      requires: { roles: [], capability: "can_approve_loops" },
    };

    expect(deniedText(approve)).toBe(
      "`/ouro approve` is for workspace members who can approve loops.",
    );
    expect(deniedText({ ...approve, requires: { ...approve.requires, roles: ["owner"] } })).toBe(
      "`/ouro approve` is for workspace owners who can approve loops.",
    );
  });

  it("says of every command exactly what help says of it", () => {
    for (const definition of GRAMMAR.commands) {
      expect(deniedText(definition)).toBe(
        `\`/ouro ${definition.id}\` is for ${requirementWords(definition.requires)}.`,
      );
    }
  });
});

describe("fill", () => {
  it("puts each value where its placeholder is, however often", () => {
    expect(fill("stop loop {loop} — `abort loop {loop} confirm`", { loop: "1847" })).toBe(
      "stop loop 1847 — `abort loop 1847 confirm`",
    );
    expect(fill("{a_b} and {c}", { a_b: "one", c: "two" })).toBe("one and two");
  });

  it("leaves a placeholder with no value as written", () => {
    expect(fill("loop {loop} in {workspace}", { loop: "1847" })).toBe("loop 1847 in {workspace}");
    expect(fill("nothing to fill", { loop: "1847" })).toBe("nothing to fill");
  });

  it("fills with an empty value: that is a value", () => {
    expect(fill("[{loop}]", { loop: "" })).toBe("[]");
  });

  it("reads only lower-case names in braces as placeholders", () => {
    expect(fill("{Loop} {loop 1} {} {1}", { Loop: "x", loop: "y", "1": "z" })).toBe(
      "{Loop} {loop 1} {} {1}",
    );
  });

  it("does not fill a value's own braces a second time", () => {
    expect(fill("{loop}", { loop: "{workspace}", workspace: "Acme Robotics" })).toBe("{workspace}");
  });

  it("fills abort loop's prompt with the loop that was typed", () => {
    const prompt = fill(registered("abort loop").confirmPrompt ?? "", { loop: "1847" });

    expect(prompt).toContain("this stops loop 1847 for good");
    expect(prompt.endsWith("`/ouro abort loop 1847 confirm`")).toBe(true);
    expect(prompt).not.toMatch(/[{}]/);
  });

  it("fills pause all's prompt with the workspace's name", () => {
    const prompt = fill(registered("pause all").confirmPrompt ?? "", {
      workspace: "Acme Robotics",
    });

    expect(prompt).toContain("stops every loop in Acme Robotics from starting anything new");
    expect(prompt.endsWith("`/ouro pause all confirm`")).toBe(true);
    expect(prompt).not.toMatch(/[{}]/);
  });
});

describe("the dispatcher's fixed replies", () => {
  it("tells somebody with no link why nothing ran, and what to do", () => {
    expect(CHAT_REPLIES.unlinked).toContain("You're not linked");
    expect(CHAT_REPLIES.unlinked).toContain("link your account first");
  });

  it("says who can reconnect a workspace that is no longer connected", () => {
    expect(CHAT_REPLIES.notConnected).toContain("An owner or admin can connect it again");
  });

  it("tells a former member that commands do nothing for them", () => {
    expect(CHAT_REPLIES.notAMember).toContain("no longer a member of this workspace");
  });

  it("admits a failure may not have taken effect, and carries no details", () => {
    expect(CHAT_REPLIES.failed).toBe(
      "Something went wrong running that command, and it may not have taken effect. Check in Ouroboros before trying again.",
    );
  });

  it("names the async command that started and did not finish", () => {
    expect(CHAT_REPLIES.asyncFailed("dry-run")).toBe(
      "`/ouro dry-run` started but did not finish: something went wrong. Check in Ouroboros before trying again.",
    );
  });

  it("says plainly when a surface cannot run commands yet", () => {
    expect(CHAT_REPLIES.surfaceUnavailable).toBe("Commands cannot be run from here yet.");
  });
});

describe("a placeholder that names something every object inherits", () => {
  it("is left as written", () => {
    expect(fill("{constructor}", {})).toBe("{constructor}");
  });
});
