import { describe, expect, it } from "vitest";

import {
  NO_VALUE,
  STATE_LABEL,
  memberStat,
  orgStat,
  overallState,
  pageSubline,
  repoStat,
  roleBreakdown,
  statRow,
  systemRows,
} from "@/app/dashboard/view";

import { engineStatus, failed, healthReport, memberPage, read, seededMembers } from "../helpers/dashboard";
import { enablement, membership, org, repo } from "../helpers/login";

/**
 * Every decision the dashboard makes, as functions.
 *
 * This is where the screen's acceptance criteria actually live. "Stop the engine and the
 * pill degrades" is one call here rather than a container to stop; "the counts are the
 * service's own" is one call here rather than a page to read. The components that draw
 * these values are covered separately and decide nothing themselves, which is what makes
 * that split honest rather than a way of testing less.
 *
 * The rule underneath most of the cases is the design system's honesty clause (§ 3.5):
 * **a computed number or an em dash**, and never a zero standing in for a number nobody
 * could read.
 */

const UP = { status: "up" } as const;
const ENGINE = read(engineStatus("0.3.1"));

describe("systemRows", () => {
  it("reports the service and its two dependencies, in that order", () => {
    const rows = systemRows(healthReport(), ENGINE);

    expect(rows.map((row) => row.id)).toEqual(["rest", "database", "engine"]);
    expect(rows.map((row) => row.state)).toEqual(["up", "up", "up"]);
  });

  it("degrades the engine's pill when the probe says the engine is down", () => {
    // The acceptance criterion, as one call: stop the engine, and the probe stops finding
    // it. Nothing else on the card moves.
    const rows = systemRows(
      healthReport({
        database: UP,
        engine: { status: "down", message: "GET /healthz responded 503" },
      }),
      ENGINE,
    );

    expect(rows.find((row) => row.id === "engine")?.state).toBe("down");
    expect(rows.find((row) => row.id === "database")?.state).toBe("up");
    expect(rows.find((row) => row.id === "rest")?.state).toBe("up");
  });

  it("shows the probe's own reason for a dependency that is down", () => {
    // The probe's message classifies the failure without naming a host, a port or a role —
    // it answers unauthenticated, so it is written to be shown.
    const rows = systemRows(
      healthReport({ database: { status: "down", message: "SELECT 1 failed (ECONNREFUSED)" } }),
      ENGINE,
    );

    expect(rows.find((row) => row.id === "database")?.note).toBe(
      "SELECT 1 failed (ECONNREFUSED)",
    );
  });

  it("still says something for a dependency that is down without a message", () => {
    // `message` is optional in the contract, and a blank note under a red pill would be the
    // one place on this card that says nothing.
    const rows = systemRows(healthReport({ database: { status: "down" } }), ENGINE);

    expect(rows.find((row) => row.id === "database")?.note).toBe("Not answering.");
  });

  it("keeps the service up when a dependency is down, because that is what `error` means", () => {
    // `status: "error"` is the service's verdict on its dependencies. Reading it as the
    // service being down would take the row explaining the outage down with it.
    const rows = systemRows(healthReport({ database: { status: "down" }, engine: UP }), ENGINE);

    expect(rows.find((row) => row.id === "rest")?.state).toBe("up");
  });

  it("takes the service down when it says it is shutting down", () => {
    // The one status that is about the process rather than its dependencies: it should
    // neither be sent traffic nor counted live.
    const rows = systemRows(healthReport({ database: UP, engine: UP }, "shutting_down"), ENGINE);

    expect(rows.find((row) => row.id === "rest")?.state).toBe("down");
  });

  it("reports the engine's build from the status call, beside the probe's verdict", () => {
    const rows = systemRows(healthReport(), read(engineStatus("9.9.9")));

    expect(rows.find((row) => row.id === "engine")?.note).toBe("Build 9.9.9.");
  });

  it("keeps the engine up on the probe's word when only the build could not be read", () => {
    // The probe decides the state; the status call supplies the version. They are separate
    // round trips and a service can stop between them, so the card says what it knows
    // rather than choosing the more alarming of two answers.
    const rows = systemRows(healthReport(), failed("The engine is not available right now."));

    expect(rows.find((row) => row.id === "engine")?.state).toBe("up");
    expect(rows.find((row) => row.id === "engine")?.note).toBe(
      "Answering; its build could not be read.",
    );
  });

  it("falls back to the status call when the probe does not mention the engine", () => {
    // Then it is the sole evidence either way, so it decides rather than being discarded.
    const present = systemRows(healthReport({ database: UP }), read(engineStatus("0.4.0")));
    const absent = systemRows(healthReport({ database: UP }), failed("engine_unavailable"));

    expect(present.find((row) => row.id === "engine")?.state).toBe("up");
    expect(present.find((row) => row.id === "engine")?.note).toBe("Build 0.4.0.");
    expect(absent.find((row) => row.id === "engine")?.state).toBe("down");
    expect(absent.find((row) => row.id === "engine")?.note).toBe("engine_unavailable");
  });

  it("draws a dependency it cannot ask about as unknown, never as up", () => {
    const rows = systemRows(healthReport({ engine: UP }), ENGINE);

    expect(rows.find((row) => row.id === "database")?.state).toBe("unknown");
  });

  it("takes the service down, and both dependencies to unknown, when the probe is silent", () => {
    // The probe not answering is evidence about the service and about nothing else: it
    // says nothing at all about a database nobody managed to ask after.
    const rows = systemRows(null, ENGINE);

    expect(rows.find((row) => row.id === "rest")?.state).toBe("down");
    expect(rows.find((row) => row.id === "database")?.state).toBe("unknown");
  });
});

describe("overallState", () => {
  it("is up only when every row is", () => {
    expect(overallState(systemRows(healthReport(), ENGINE))).toBe("up");
  });

  it("is down when anything is down", () => {
    expect(overallState(systemRows(healthReport({ database: { status: "down" } }), ENGINE))).toBe(
      "down",
    );
  });

  it("is unknown rather than up when a row could not be read", () => {
    // A card headed "operational" above a row nobody could read would be the screen making
    // a claim on evidence it does not have.
    expect(overallState(systemRows(healthReport({ engine: UP }), ENGINE))).toBe("unknown");
  });

  it("prefers down to unknown, so the worst row is the one the head reports", () => {
    expect(
      overallState(systemRows(healthReport({ engine: { status: "down" } }), ENGINE)),
    ).toBe("down");
  });

  it("names all three states in words, not only in colour", () => {
    expect(Object.keys(STATE_LABEL).sort()).toEqual(["down", "unknown", "up"]);
    for (const label of Object.values(STATE_LABEL)) expect(label).not.toBe("");
  });
});

describe("memberStat", () => {
  it("counts the seeded workspace and names the roles in it", () => {
    const stat = memberStat(read(memberPage()));

    expect(stat.value).toBe("3");
    expect(stat.delta).toBe("1 owner · 1 admin · 1 member");
    expect(stat.failed).toBe(false);
  });

  it("counts the service's total, not the rows that fitted in the window", () => {
    const stat = memberStat(read(memberPage(seededMembers(), 412)));

    expect(stat.value).toBe("412");
  });

  it("says so when the breakdown describes only part of the workspace", () => {
    // Describing a hundred people as though they were all four hundred is the specific way
    // this card could lie.
    const stat = memberStat(read(memberPage(seededMembers(), 412)));

    expect(stat.delta).toContain("of the first 3");
  });

  it("is an em dash and the reason when the listing failed, never a zero", () => {
    const stat = memberStat(failed("No such tenant."));

    expect(stat.value).toBe(NO_VALUE);
    expect(stat.delta).toBe("No such tenant.");
    expect(stat.failed).toBe(true);
  });

  it("reads sensibly for a workspace nobody has joined", () => {
    const stat = memberStat(read(memberPage([])));

    expect(stat.value).toBe("0");
    expect(stat.delta).toBe("Nobody has joined yet.");
  });
});

describe("roleBreakdown", () => {
  it("orders by seniority rather than by count, so it reads the same every render", () => {
    expect(roleBreakdown(["viewer", "owner", "member", "admin"])).toBe(
      "1 owner · 1 admin · 1 member · 1 viewer",
    );
  });

  it("pluralises each count", () => {
    expect(roleBreakdown(["owner", "owner", "member"])).toBe("2 owners · 1 member");
  });

  it("names only the roles actually held", () => {
    expect(roleBreakdown(["viewer"])).toBe("1 viewer");
  });

  it("is empty for nobody, so the caller can say something else", () => {
    expect(roleBreakdown([])).toBe("");
  });
});

describe("orgStat", () => {
  it("counts the enabled organisations against the ones recorded", () => {
    const stat = orgStat(read(enablement([[org(), [repo()]]])));

    expect(stat.value).toBe("1");
    expect(stat.delta).toBe("of 1 recorded");
  });

  it("separates *known* from *switched on*, which are two different numbers", () => {
    const list = enablement([
      [org({ login: "acme-robotics" }), []],
      [org({ id: "b", login: "acme-labs", enabled: false }), []],
    ]);

    expect(orgStat(read(list)).value).toBe("1");
    expect(orgStat(read(list)).delta).toBe("of 2 recorded");
  });

  it("says how much of a long list it actually read", () => {
    const list = enablement([[org(), []]], 340);

    expect(orgStat(read(list)).delta).toBe("of 340 recorded, 1 read");
  });

  it("points somewhere when there is nothing recorded at all", () => {
    expect(orgStat(read(enablement([]))).delta).toBe(
      "None recorded — enable one on the sign-in screen.",
    );
  });

  it("is an em dash and the reason when the read failed", () => {
    const stat = orgStat(failed("The engine is not available right now."));

    expect(stat.value).toBe(NO_VALUE);
    expect(stat.failed).toBe(true);
  });
});

describe("repoStat", () => {
  it("counts the seeded repository", () => {
    const stat = repoStat(read(enablement([[org(), [repo()]]])));

    expect(stat.value).toBe("1");
    expect(stat.delta).toBe("of 1 recorded");
  });

  it("counts a repository as live only when its organisation is on too", () => {
    // Both flags, not one: a repository is in scope only when its own `enabled` and its
    // organisation's are both true. Counting the repository's alone would report it as
    // live while the switch above it is off.
    const held = enablement([[org({ enabled: false }), [repo()]]]);

    expect(repoStat(read(held)).value).toBe("0");
  });

  it("says out loud how many are held back by a disabled organisation", () => {
    // The trap the two-flag rule exists to name. Silently counting them out would leave
    // somebody looking for a repository they can see is switched on.
    const held = enablement([
      [org(), [repo()]],
      [org({ id: "b", login: "acme-labs", enabled: false }), [repo({ id: "r2", name: "atlas" })]],
    ]);

    expect(repoStat(read(held)).value).toBe("1");
    expect(repoStat(read(held)).delta).toBe(
      "of 2 recorded · 1 held by a disabled organisation",
    );
  });

  it("does not count a repository that is switched off itself", () => {
    const off = enablement([[org(), [repo({ enabled: false })]]]);

    expect(repoStat(read(off)).value).toBe("0");
    expect(repoStat(read(off)).delta).toBe("of 1 recorded");
  });

  it("reads sensibly for an organisation with nothing under it", () => {
    expect(repoStat(read(enablement([[org(), []]]))).delta).toBe("None recorded yet.");
  });
});

describe("the stat row", () => {
  it("is the mockup's four tiles, in its order", () => {
    const row = statRow(read(memberPage()), read(enablement([[org(), [repo()]]])));

    expect(row.map((stat) => stat.id)).toEqual(["loops", "members", "orgs", "repos"]);
  });

  it("draws the loop count as an em dash, because nothing can answer it yet", () => {
    // "Zero loops are running" and "nothing can tell you how many are running" are
    // different facts, and only the second is true. A zero here would be the screen
    // inventing a loop engine.
    const [loops] = statRow(read(memberPage()), read(enablement([])));

    expect(loops?.value).toBe(NO_VALUE);
    expect(loops?.delta).toContain("No run data yet");
    expect(loops?.failed).toBe(false);
  });

  it("degrades one tile without touching the others", () => {
    // The property the whole screen is built on: one failed read is one degraded card.
    const row = statRow(failed("No such tenant."), read(enablement([[org(), [repo()]]])));

    expect(row.filter((stat) => stat.failed).map((stat) => stat.id)).toEqual(["members"]);
    expect(row.find((stat) => stat.id === "orgs")?.value).toBe("1");
  });
});

describe("pageSubline", () => {
  it("names who is looking and what they hold", () => {
    expect(pageSubline(membership(), "Ken Suenobu")).toBe(
      "Ken Suenobu · owner of acme-robotics",
    );
  });

  it("says nothing about a lifecycle, because the contract publishes none", () => {
    // *Names a lifecycle that is not the normal one* was here. `OrgRow` carries no `status`
    // ([#719](https://github.com/NobuData/ouroboros/issues/719)) — the organization plugin
    // has no lifecycle column — so every workspace a session can reach is one you can work
    // in, and there is nothing left for this line to warn about.
    expect(pageSubline(membership(), "Ken Suenobu")).not.toContain("workspace");
  });

  it("reports the role the gate resolved rather than assuming one", () => {
    expect(pageSubline(membership({ roles: ["viewer"] }), "Maya Chen")).toContain(
      "viewer of acme-robotics",
    );
  });

  it("names the strongest role held, where the contract carries a list", () => {
    // There is room for a word and the truthful word is the strongest: somebody who is an
    // owner and a member may do everything an owner may.
    expect(pageSubline(membership({ roles: ["member", "owner"] }), "Ken Suenobu")).toContain(
      "owner of",
    );
  });
});
