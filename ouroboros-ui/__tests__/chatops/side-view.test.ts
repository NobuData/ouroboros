import { describe, expect, it } from "vitest";

import {
  COMMANDS_CAPTION,
  NO_CANDIDATES,
  ROUTING_ROLE_NOTE,
  TEAMS_QUALIFIER,
  chatRoutes as chatRoutesOf,
  deniedText,
  onCallView,
  routeChannelWarning,
  routeChoices,
  routePickerName,
  routeSwitchName,
  runnable,
  stageChip,
  stageNote,
  stageTipName,
  tryLine,
  tryName,
  usageParts,
  withRoute,
} from "@/app/chatops/view";

import { boundChannelList, channel, chatRoute, chatRoutes, onCall, routeChannel } from "../helpers/chatops";
import { EXPLAIN_UNAVAILABLE, commands } from "../helpers/console";

/**
 * What the commands and routing cards say and decide (#543): a command's code form and marks
 * derived from the grammar alone, the routes filtered to chat targets, and who **+ DM on-call**
 * reaches.
 */

/** A command of the fixture grammar, by id. */
function command(id: string) {
  return commands().find((one) => one.id === id)!;
}

describe("a command's code form", () => {
  it("is the prefix and the grammar's example, with optional arguments as hints", () => {
    expect(usageParts(command("status"))).toEqual([{ text: "/ouro status", hint: false }]);
    expect(usageParts(command("queue"))).toEqual([
      { text: "/ouro queue", hint: false },
      { text: " #485", hint: false },
      { text: " [workflow]", hint: true },
    ]);
    expect(usageParts(command("pause loop"))).toEqual([
      { text: "/ouro pause loop", hint: false },
      { text: " 1847", hint: false },
    ]);
  });

  it("takes optional from the argument, not from how the example is spelt", () => {
    const parts = usageParts({
      id: "ship",
      usage: "ship #12 fast",
      arguments: [
        { name: "ticket", type: "ticket", optional: false, description: "", completion: null },
        { name: "speed", type: "keyword", optional: true, description: "", completion: null },
      ],
    });

    expect(parts.map((part) => part.hint)).toEqual([false, false, true]);
    expect(parts.map((part) => part.text).join("")).toBe("/ouro ship #12 fast");
  });

  it("still reads an example that brackets a word, or does not start with the name", () => {
    expect(usageParts({ id: "help", usage: "help [command]", arguments: [] })[1]).toEqual({
      text: " [command]",
      hint: true,
    });
    expect(usageParts({ id: "pause loop", usage: "hold 1847", arguments: [] }).map((part) => part.text).join("")).toBe(
      "/ouro hold 1847",
    );
  });
});

describe("a command's marks", () => {
  it("offers Try it only for a command that is available and allowed", () => {
    expect(runnable(command("status"))).toBe(true);
    expect(runnable(command("pause loop"))).toBe(false);
    expect(runnable(command("explain pr"))).toBe(false);
  });

  it("prefills the prefix, the name and a space", () => {
    expect(tryLine(command("dry-run"))).toBe("/ouro dry-run ");
    expect(tryLine(command("pause loop"))).toBe("/ouro pause loop ");
    expect(tryName(command("status"))).toBe("Try /ouro status in the composer");
  });

  it("says why a denied command is dimmed, in the service's words", () => {
    expect(deniedText(command("status"))).toBeNull();
    expect(deniedText(command("pause loop"))).toBe("Not available to you — needs admin");
    expect(deniedText({ allowed: false, deniedReason: null })).toBe("Not available to you — it is not open to you");
  });

  it("names the issue a staged command waits for from the grammar's own note", () => {
    expect(stageChip(command("explain pr"))).toBe("v2 · #546");
    expect(stageNote(command("explain pr"))).toBe(EXPLAIN_UNAVAILABLE);
    expect(stageChip({ stage: "v2", unavailableReply: "Not yet." })).toBe("v2");
    expect(stageChip({ stage: "v2", unavailableReply: null })).toBe("v2");
    expect(stageNote({ stage: "v2", unavailableReply: " " })).toBeNull();
    expect(stageChip(command("status"))).toBeNull();
    expect(stageNote(command("status"))).toBeNull();
    expect(stageTipName(command("explain pr"))).toBe("Why /ouro explain pr cannot be run yet");
  });

  it("keeps the caption verbatim and qualifies its Teams third", () => {
    expect(COMMANDS_CAPTION).toBe("Identical in Slack, Teams, and the in-app console. Tab-completion everywhere.");
    expect(TEAMS_QUALIFIER).toBe("Teams arrives with #547");
  });
});

describe("the routes", () => {
  it("are the ones that post to a chat channel, in the served order", () => {
    expect(chatRoutesOf(chatRoutes().items).map((route) => route.kind)).toEqual([
      "custom:loop-finished",
      "custom:blocking-questions",
      "custom:build-failures",
      "custom:weekly-insights",
      "custom:stage-transitions",
    ]);
    // A route that is not a chat route is not listed.
    expect(chatRoutesOf([chatRoute("daily_digest", null)])).toEqual([]);
  });

  it("replace one route by kind, leaving the order and the rest alone", () => {
    const routes = chatRoutes();
    const off = chatRoute("custom:build-failures", { label: "Build failures" }, { enabled: false });
    const after = withRoute(routes, off);

    expect(after.items.map((route) => route.kind)).toEqual(routes.items.map((route) => route.kind));
    expect(after.items[3]).toBe(off);
    expect(after.items[1]).toBe(routes.items[1]);
  });

  it("name their controls by the service's label", () => {
    const [route] = chatRoutesOf([chatRoute("custom:build-failures", { label: "Build failures" })]);

    expect(routeSwitchName(route!)).toBe("Publish: Build failures");
    expect(routePickerName(route!)).toBe("Channel for Build failures");
  });

  it("offer the bound channels, and the route's own when it is no longer one", () => {
    const list = boundChannelList();

    expect(routeChoices(list, null).map((choice) => choice.name)).toEqual(["#ouroboros-loops", "#helios-alerts"]);
    expect(routeChoices(list, routeChannel("helios-alerts"))).toHaveLength(2);
    expect(routeChoices(list, { id: "gone", name: "old-builds" }).map((choice) => choice.name)).toEqual([
      "#old-builds",
      "#ouroboros-loops",
      "#helios-alerts",
    ]);
    expect(routeChoices([channel("general")], null)).toEqual([]);
  });

  it("say when the channel cannot be posted to", () => {
    expect(routeChannelWarning(null)).toBeNull();
    expect(routeChannelWarning(routeChannel("helios-alerts"))).toBeNull();
    expect(routeChannelWarning(routeChannel("helios-alerts", { joined: false }))).toBe(
      "Ouroboros is not in this channel — nothing is posted there",
    );
    expect(routeChannelWarning(routeChannel("helios-alerts", { archived: true, joined: false }))).toBe(
      "archived in Slack — nothing is posted there",
    );
  });

  it("explain the read-only card in the page's role words", () => {
    expect(ROUTING_ROLE_NOTE).toContain("an Owner or a Maintainer");
  });
});

describe("+ DM on-call", () => {
  it("names the designee, nobody, one who is not linked, or that it could not be read", () => {
    expect(onCallView({ ok: true, value: onCall() })).toEqual({ text: "Maya Chen", warn: false });
    expect(onCallView({ ok: true, value: onCall({ designee: null }) })).toEqual({
      text: "nobody designated",
      warn: true,
    });
    expect(
      onCallView({ ok: true, value: onCall({ designee: { memberId: "m", name: "Maya Chen", linked: false } }) }),
    ).toEqual({ text: "Maya Chen — not linked to Slack", warn: true });
    expect(onCallView({ ok: false, reason: "nope" })).toEqual({ text: "designee could not be read", warn: true });
  });

  it("says what has to happen before anybody can be designated", () => {
    expect(NO_CANDIDATES).toBe("Members must link their Slack identity first (/ouro link).");
  });
});
