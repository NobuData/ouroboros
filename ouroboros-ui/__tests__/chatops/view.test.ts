import { describe, expect, it } from "vitest";

import {
  BIND_ROLE_REASON,
  CHATOPS_EYEBROW,
  CHATOPS_HEADLINE,
  CHATOPS_POLL_SECONDS,
  CHATOPS_SUBLINE,
  DELIVERY_AUDIT_PATH,
  ERROR_NOTE,
  INSTALL_ROLE_NOTE,
  LINK_COMMAND,
  MANAGE_SETTINGS_PATH,
  NEVER_LISTED,
  NEVER_VERIFIED,
  NO_ROUTES,
  PURPOSES,
  PURPOSE_LABELS,
  PURPOSE_ROUTES,
  REINSTALL_ROLE_NOTE,
  REINSTALL_UNAVAILABLE,
  REVOKED_NOTE,
  SCOPES_OK,
  SETUP_GUIDE_HREF,
  SETUP_STEPS,
  appText,
  botRemoved,
  botText,
  boundChannels,
  boundNotice,
  boundText,
  brokenNote,
  channelName,
  channelsBody,
  chooseChannelLabel,
  deliveryBanner,
  healthFacts,
  healthLine,
  installHref,
  isChatOpsPage,
  journeyFor,
  listedText,
  membersText,
  notJoinedNote,
  offeredChannels,
  offersAddChannel,
  openChannelLink,
  openName,
  pickerTitle,
  purposeLabel,
  purposeQuestion,
  refusalText,
  refused,
  repairFor,
  revokedReason,
  routesText,
  scopesText,
  showsHealth,
  showsUnlinked,
  statusText,
  unbindName,
  unboundNotice,
  verificationNote,
  verifiedText,
} from "@/app/chatops/view";

import {
  CHATOPS_READ_AT,
  INSTALL_PATH,
  boundChannelList,
  channel,
  channels,
  chatOpsPage,
  connection,
  deadLettering,
  delivery,
  notConfigured,
  notConnected,
  revoked,
  unboundChannels,
} from "../helpers/chatops";

/**
 * What the Chat Ops page says and decides (#541): the head verbatim, which state shows what, the
 * strip's text for every state, and the channel rules — each as a pure function.
 */

const NOW = new Date(CHATOPS_READ_AT);
const STATES = ["not_configured", "not_connected", "connected", "revoked", "error"] as const;

describe("the head", () => {
  it("is mockup 19's, verbatim", () => {
    expect(CHATOPS_EYEBROW).toBe("Chat Ops");
    expect(CHATOPS_HEADLINE).toBe("The loop reports where your team already lives.");
    expect(CHATOPS_SUBLINE).toBe(
      "Finished loops announce themselves. Blocked builds ask their question in-channel and wait. Every control in this app is also a command — or a sentence.",
    );
  });

  it("offers Add channel only while Slack is connected", () => {
    expect(STATES.filter((state) => offersAddChannel({ state }))).toEqual(["connected"]);
  });

  it("names the roles as the Members card shows them when a reader may not bind", () => {
    expect(BIND_ROLE_REASON).toBe("Binding a channel is for an Owner or a Maintainer.");
  });
});

describe("Open #channel ↗", () => {
  it("is the loops channel's own link, labelled with its name", () => {
    const page = chatOpsPage({ channels: channels(boundChannelList()) });

    expect(openChannelLink(page)).toEqual({
      label: "Open #ouroboros-loops ↗",
      href: "https://app.slack.com/client/T024AB/C0OUROBO",
    });
  });

  it("is absent — not dead — while no channel is bound for loops", () => {
    expect(openChannelLink(chatOpsPage())).toBeNull();
    // Alerts alone is not a loops channel.
    expect(
      openChannelLink(chatOpsPage({ channels: channels([channel("helios-alerts", { purpose: "alerts" })]) })),
    ).toBeNull();
  });

  it("is absent whenever Slack is not connected, whatever the channels say", () => {
    for (const state of STATES.filter((one) => one !== "connected")) {
      const page = chatOpsPage({ connection: connection({ state }), channels: channels(boundChannelList()) });

      expect(openChannelLink(page), state).toBeNull();
    }
  });

  it("is absent for an archived loops channel, one with no link, and an unread list", () => {
    const archived = channels([channel("ouroboros-loops", { purpose: "loops", archived: true })]);
    const linkless = channels([channel("ouroboros-loops", { purpose: "loops", url: "" })]);

    expect(openChannelLink(chatOpsPage({ channels: archived }))).toBeNull();
    expect(openChannelLink(chatOpsPage({ channels: linkless }))).toBeNull();
    expect(openChannelLink({ ...chatOpsPage(), channels: { ok: false, reason: "nope" } })).toBeNull();
  });
});

describe("the health strip", () => {
  it("is drawn whenever a connection exists — working, revoked or failing", () => {
    expect(STATES.filter((state) => showsHealth({ state }))).toEqual(["connected", "revoked", "error"]);
  });

  it("reads as the issue's line for a healthy connection", () => {
    expect(healthLine(connection(), NOW)).toBe("acme-robotics · app v2.4 · scopes ✓ · active · verified 2m ago");
  });

  it("says revoked, with the platform's reason", () => {
    expect(statusText(revoked())).toBe("revoked — app_uninstalled");
    expect(healthLine(revoked(), NOW)).toBe(
      "acme-robotics · app v2.4 · scopes ✓ · revoked — app_uninstalled · verified 2m ago",
    );
  });

  it("says error, with or without a reason, and passes an unknown state through", () => {
    expect(statusText({ state: "error", statusDetail: "ratelimited" })).toBe("error — ratelimited");
    expect(statusText({ state: "error", statusDetail: null })).toBe("error");
    expect(statusText({ state: "error", statusDetail: "" })).toBe("error");
    expect(statusText({ state: "connected", statusDetail: null })).toBe("active");
    expect(statusText({ state: "paused" as never, statusDetail: null })).toBe("paused");
  });

  it("names the missing scopes, so they can be read", () => {
    expect(scopesText([])).toBe(SCOPES_OK);
    expect(SCOPES_OK).toBe("scopes ✓");
    expect(scopesText(["groups:read"])).toBe("1 scope missing: groups:read");
    expect(scopesText(["chat:write", "groups:read"])).toBe("2 scopes missing: chat:write, groups:read");
  });

  it("writes the app version once, whether or not the service prefixed it", () => {
    expect(appText("v1.0")).toBe("app v1.0");
    expect(appText("2.4")).toBe("app v2.4");
    expect(appText(null)).toBeNull();
    expect(appText(" ")).toBeNull();
  });

  it("ages the last verification against the page's read", () => {
    expect(verifiedText("2026-10-12T13:58:00.000Z", NOW)).toBe("verified 2m ago");
    expect(verifiedText("2026-10-12T13:59:30.000Z", NOW)).toBe("verified 30s ago");
    expect(verifiedText("2026-10-12T11:48:00.000Z", NOW)).toBe("verified 2h 12m ago");
    expect(verifiedText("2026-10-09T14:00:00.000Z", NOW)).toBe("verified 3d ago");
    expect(verifiedText(null, NOW)).toBe(NEVER_VERIFIED);
  });

  it("gives each fact a tone beside its words, and leaves out what the service does not know", () => {
    expect(healthFacts(connection(), NOW).map((fact) => [fact.key, fact.tone])).toEqual([
      ["workspace", "plain"],
      ["app", "plain"],
      ["scopes", "plain"],
      ["status", "ok"],
      ["verified", "plain"],
    ]);

    const broken = healthFacts(
      connection({ state: "error", missingScopes: ["chat:write"], workspace: null, appVersion: null }),
      NOW,
    );

    expect(broken.map((fact) => [fact.key, fact.tone])).toEqual([
      ["scopes", "warn"],
      ["status", "err"],
      ["verified", "plain"],
    ]);
    // Every toned fact still says what it means in words.
    for (const fact of broken) expect(fact.text).toMatch(/[a-z]/);
  });

  it("explains a broken connection, and nothing for a working one", () => {
    expect(brokenNote({ state: "revoked" })).toBe(REVOKED_NOTE);
    expect(brokenNote({ state: "error" })).toBe(ERROR_NOTE);
    expect(brokenNote({ state: "connected" })).toBeNull();
  });

  it("offers Re-install to an owner or an admin, and tells everyone else who can", () => {
    expect(repairFor(revoked(), true)).toEqual({ kind: "reinstall", href: INSTALL_PATH });
    expect(repairFor(connection({ state: "error" }), true)).toEqual({ kind: "reinstall", href: INSTALL_PATH });
    expect(repairFor(revoked(), false)).toEqual({ kind: "note", text: REINSTALL_ROLE_NOTE });
    expect(REINSTALL_ROLE_NOTE).toBe("An Owner or a Maintainer can re-install the app.");
  });

  it("offers no repair for a working connection, and says so when there is no app left to install", () => {
    expect(repairFor(connection(), true)).toBeNull();
    expect(repairFor(connection(), false)).toBeNull();
    expect(repairFor({ state: "revoked", installPath: null }, true)).toEqual({
      kind: "note",
      text: REINSTALL_UNAVAILABLE,
    });
  });

  it("says when a verification could not reach Slack, and nothing otherwise", () => {
    expect(verificationNote("unreachable")).toMatch(/could not be reached/);
    expect(verificationNote("verified")).toBeNull();
    expect(verificationNote("revoked")).toBeNull();
  });
});

describe("publish health (#545)", () => {
  const routes = chatOpsPage().routes;

  it("says nothing while nothing was given up on and nothing keeps failing", () => {
    expect(deliveryBanner(connection(), routes)).toBeNull();
    expect(
      deliveryBanner(connection({ delivery: delivery({ state: "retrying", retrying: 2 }) }), routes),
      "a first failure is weather",
    ).toBeNull();
  });

  it("counts the dead letters, names the routes by their labels and quotes Slack", () => {
    expect(deliveryBanner(deadLettering(), routes)).toEqual({
      headline: "2 messages could not be delivered to Slack.",
      detail: "Affected: Build failures. Slack's last answer: channel_not_found.",
      retryable: true,
    });
    expect(
      deliveryBanner(connection({ delivery: delivery({ state: "dead_lettered", deadLettered: 1 }) }), routes),
    ).toEqual({ headline: "1 message could not be delivered to Slack.", detail: null, retryable: true });
  });

  it("falls back to a route's kind where the routes could not be read, or name no such route", () => {
    const unread = { ok: false, reason: "nope" } as const;

    expect(deliveryBanner(deadLettering(), unread)?.detail).toContain("Affected: custom:build-failures.");
    expect(
      deliveryBanner(
        connection({ delivery: delivery({ state: "dead_lettered", deadLettered: 1, affectedRoutes: ["custom:unknown"] }) }),
        routes,
      )?.detail,
    ).toBe("Affected: custom:unknown.");
  });

  it("names the escalation's direct message, which is on no routing row", () => {
    const dm = connection({
      delivery: delivery({ state: "dead_lettered", deadLettered: 1, affectedRoutes: ["needs_you_dm"] }),
    });

    expect(deliveryBanner(dm, routes)?.detail).toBe("Affected: On-call DM.");
    expect(deliveryBanner(dm, { ok: false, reason: "nope" })?.detail).toBe("Affected: On-call DM.");
  });

  it("says a message keeps failing while it is retried — which needs no retry of its own", () => {
    const one = connection({ delivery: delivery({ state: "retrying", retrying: 1, stuck: 1 }) });
    const three = connection({
      delivery: delivery({
        state: "retrying",
        retrying: 3,
        stuck: 3,
        affectedRoutes: ["custom:build-failures", "custom:loop-finished"],
        lastError: "ignored_without_a_dead_letter",
      }),
    });

    expect(deliveryBanner(one, routes)).toEqual({
      headline: "1 message keeps failing to reach Slack, and is still being retried.",
      detail: null,
      retryable: false,
    });
    expect(deliveryBanner(three, routes)).toEqual({
      headline: "3 messages keep failing to reach Slack, and are still being retried.",
      detail: "Affected: Build failures, Loop finished (merged).",
      retryable: false,
    });
  });

  it("is drawn for a failing connection without a retry, and never under a revoked one or none", () => {
    const dead = deadLettering().delivery;

    expect(deliveryBanner(connection({ state: "error", delivery: dead }), routes)?.retryable).toBe(false);
    for (const state of ["revoked", "not_connected", "not_configured"] as const) {
      expect(deliveryBanner(connection({ state, delivery: dead }), routes), state).toBeNull();
    }
  });

  it("links the audit log's own section", () => {
    expect(DELIVERY_AUDIT_PATH).toBe("/settings#audit");
  });
});

describe("the unlinked reader (#545)", () => {
  it("is told only while Slack is connected and they have no link", () => {
    expect(showsUnlinked(connection({ viewerLinked: false }))).toBe(true);
    expect(showsUnlinked(connection())).toBe(false);
    for (const state of STATES.filter((one) => one !== "connected")) {
      expect(showsUnlinked(connection({ state, viewerLinked: false })), state).toBe(false);
    }
  });

  it("names the command that links, typed in Slack", () => {
    expect(LINK_COMMAND).toBe("/ouro link");
  });
});

describe("a revoked connection's reason (#545)", () => {
  it.each([
    ["app_uninstalled", "The app was removed from the Slack workspace."],
    ["tokens_revoked", "The app's token was revoked in Slack."],
    ["token_revoked", "The app's token was revoked in Slack."],
    ["account_inactive", "The Slack account that installed the app was deactivated."],
    ["invalid_auth", "Slack no longer recognises the app's token."],
  ])("reads %s in words", (statusDetail, sentence) => {
    expect(revokedReason({ state: "revoked", statusDetail })).toBe(sentence);
  });

  it("says nothing for a reason it does not know, no reason, or a connection that is not revoked", () => {
    expect(revokedReason({ state: "revoked", statusDetail: "something_new" })).toBeNull();
    expect(revokedReason({ state: "revoked", statusDetail: null })).toBeNull();
    expect(revokedReason({ state: "error", statusDetail: "app_uninstalled" })).toBeNull();
  });
});

describe("a channel the bot was removed from (#545)", () => {
  it("is one that is live in Slack and without the bot", () => {
    expect(botRemoved({ joined: false, archived: false })).toBe(true);
    expect(botRemoved({ joined: true, archived: false })).toBe(false);
    expect(botRemoved({ joined: false, archived: true })).toBe(false);
  });
});

describe("the install journey", () => {
  it("is the page for the two states with no connection, and for no other", () => {
    expect(STATES.map((state) => journeyFor({ state }))).toEqual([
      "not_configured",
      "not_connected",
      null,
      null,
      null,
    ]);
  });

  it("offers Install only where an app is registered, nothing is installed, and the reader may", () => {
    expect(installHref(notConnected(), true)).toBe(INSTALL_PATH);
    expect(installHref(notConnected(), false)).toBeNull();
    // Nothing to install yet.
    expect(installHref(notConfigured(), true)).toBeNull();
    // Already installed: the strip's Re-install is the way, not this.
    expect(installHref(connection(), true)).toBeNull();
    expect(installHref(revoked(), true)).toBeNull();
    expect(INSTALL_ROLE_NOTE).toBe("An Owner or a Maintainer can install it.");
  });

  it("names four steps and the three credentials, and links the setup guide", () => {
    expect(SETUP_STEPS).toHaveLength(4);
    expect(SETUP_STEPS.join(" ")).toMatch(/manifest/);
    expect(SETUP_STEPS.join(" ")).toMatch(/OURO_SLACK_CLIENT_ID, OURO_SLACK_CLIENT_SECRET and OURO_SLACK_SIGNING_SECRET/);
    expect(SETUP_STEPS.join(" ")).toMatch(/Restart/);
    expect(SETUP_GUIDE_HREF).toBe("https://github.com/NobuData/ouroboros/blob/main/docs/CHATOPS_SETUP.md");
  });
});

describe("the purposes", () => {
  it("are three, in order, each with the routes it switches on", () => {
    expect(PURPOSES).toEqual(["loops", "alerts", "leads"]);
    expect(PURPOSES.map((purpose) => PURPOSE_LABELS[purpose])).toEqual(["Loops", "Alerts", "Leads"]);
    expect(PURPOSE_ROUTES.loops).toBe(
      "Blocking questions, with a DM to the on-call person · loop finished · stage transitions (off)",
    );
    expect(PURPOSE_ROUTES.alerts).toBe("Build failures");
    expect(PURPOSE_ROUTES.leads).toBe("The weekly digest");
  });

  it("label a purpose this build does not know with its own value", () => {
    expect(purposeLabel("alerts")).toBe("Alerts");
    expect(purposeLabel("incidents")).toBe("incidents");
  });

  it("word each button of the post-install step", () => {
    expect(PURPOSES.map(chooseChannelLabel)).toEqual([
      "Choose a Loops channel",
      "Choose an Alerts channel",
      "Choose a Leads channel",
    ]);
  });
});

describe("the channels", () => {
  it("offers every channel but the archived, bound ones first and then by name", () => {
    expect(offeredChannels(boundChannelList()).map((one) => one.name)).toEqual([
      "helios-alerts",
      "ouroboros-loops",
      "helios-private",
    ]);
    expect(offeredChannels(unboundChannels()).map((one) => one.name)).not.toContain("old-builds");
  });

  it("lists the bound channels in the purposes' order", () => {
    expect(boundChannels(boundChannelList()).map((one) => one.name)).toEqual(["ouroboros-loops", "helios-alerts"]);
    expect(boundChannels(unboundChannels())).toEqual([]);
  });

  it("decides the connected page's body", () => {
    expect(channelsBody(chatOpsPage())).toBe("first");
    expect(channelsBody(chatOpsPage({ channels: channels(boundChannelList()) }))).toBe("bound");
    expect(channelsBody({ ...chatOpsPage(), channels: { ok: false, reason: "nope" } })).toBe("unread");
    for (const state of STATES.filter((one) => one !== "connected")) {
      expect(channelsBody(chatOpsPage({ connection: connection({ state }) })), state).toBeNull();
    }
  });

  it("keeps a revoked or failing connection's bound channels as history, and nothing else (#545)", () => {
    const bound = channels(boundChannelList(), { connected: false });

    for (const state of ["revoked", "error"] as const) {
      expect(channelsBody(chatOpsPage({ connection: connection({ state }), channels: bound })), state).toBe("history");
      expect(
        channelsBody({ ...chatOpsPage({ connection: connection({ state }) }), channels: { ok: false, reason: "nope" } }),
        state,
      ).toBeNull();
    }
    for (const state of ["not_configured", "not_connected"] as const) {
      expect(channelsBody(chatOpsPage({ connection: connection({ state }), channels: bound })), state).toBeNull();
    }
  });

  it("describes a channel in words", () => {
    const loops = channel("ouroboros-loops", { purpose: "loops" });

    expect(channelName(loops)).toBe("#ouroboros-loops");
    expect(membersText(24)).toBe("24 members");
    expect(membersText(1)).toBe("1 member");
    expect(membersText(0)).toBe("0 members");
    expect(membersText(null)).toBeNull();
    expect(botText({ joined: true })).toBe("bot is a member");
    expect(botText({ joined: false })).toBe("bot is not in this channel");
    expect(boundText(loops)).toBe("bound for Loops");
    expect(boundText(channel("general"))).toBeNull();
    expect(routesText(["blocking_question", "loop_finished"])).toBe("routes: blocking_question, loop_finished");
    expect(routesText([])).toBe(NO_ROUTES);
    expect(openName(loops)).toBe("Open #ouroboros-loops in Slack");
    expect(unbindName(loops)).toBe("Unbind #ouroboros-loops");
  });

  it("links Manage in Settings to the notifications section", () => {
    expect(MANAGE_SETTINGS_PATH).toBe("/settings#notifications");
  });
});

describe("the picker's words", () => {
  it("titles itself, with the purpose it was opened for", () => {
    expect(pickerTitle(null)).toBe("Add a channel");
    expect(pickerTitle("loops")).toBe("Add a channel for Loops");
    expect(purposeQuestion(channel("helios-alerts"))).toBe("What is #helios-alerts for?");
  });

  it("explains a channel the bot is not in before anything is asked", () => {
    const open = notJoinedNote(channel("general", { joined: false }));
    const closed = notJoinedNote(channel("helios-private", { joined: false, isPrivate: true }));

    expect(open).toBe(
      "Ouroboros is not in #general, so it cannot post there yet. In Slack, open the channel and send /invite @Ouroboros, then refresh here. Private channels are added the same way.",
    );
    expect(closed).toMatch(/\/invite @Ouroboros/);
    expect(closed).toMatch(/This is a private channel: the bot cannot join it on its own/);
  });

  it("says when the list was read from Slack", () => {
    expect(listedText("2026-10-12T13:55:00.000Z", NOW)).toBe("Listed from Slack 5m ago.");
    expect(listedText(null, NOW)).toBe(NEVER_LISTED);
  });

  it("reports a bind and an unbind", () => {
    expect(boundNotice(channel("helios-alerts"), "alerts")).toBe("#helios-alerts is bound for Alerts.");
    expect(unboundNotice(channel("helios-alerts"))).toBe("#helios-alerts is no longer bound.");
  });
});

describe("writes and reads", () => {
  it("tells a refusal from a payload", () => {
    expect(refused({ error: "No." })).toBe(true);
    expect(refused(channels())).toBe(false);
  });

  it("prints the service's sentence, and its own only when there is none", () => {
    expect(refusalText("Slack refused.", "Try again.")).toBe("Slack refused.");
    expect(refusalText("  ", "Try again.")).toBe("Try again.");
  });

  it("recognises the page's payload", () => {
    expect(isChatOpsPage(chatOpsPage())).toBe(true);
    expect(isChatOpsPage({ ...chatOpsPage(), channels: { ok: false, reason: "x" } })).toBe(true);
    expect(isChatOpsPage({ ...chatOpsPage(), grammar: { ok: false, reason: "x" } })).toBe(true);
    // A payload from before #543 — no grammar, routes or on-call — is not this page's.
    expect(isChatOpsPage({ connection: connection(), channels: { ok: true, value: {} } })).toBe(false);
    expect(isChatOpsPage({ connection: connection() })).toBe(false);
    expect(isChatOpsPage({ channels: { ok: true } })).toBe(false);
    expect(isChatOpsPage(null)).toBe(false);
    expect(isChatOpsPage("page")).toBe(false);
  });

  it("re-reads at the product's own cadence", () => {
    expect(CHATOPS_POLL_SECONDS).toBeGreaterThanOrEqual(10);
    expect(CHATOPS_POLL_SECONDS).toBeLessThanOrEqual(15);
  });
});
