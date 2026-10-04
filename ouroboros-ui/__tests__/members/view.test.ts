import { describe, expect, it } from "vitest";

import {
  CAPABILITY_CONSEQUENCE,
  NEVER,
  ROLE_CHOICES,
  WRITE_FAILED,
  cardRows,
  choiceOf,
  demotionWarning,
  directorySyncLine,
  initials,
  invitedAgo,
  isLastOwner,
  lastUsed,
  refusalSentence,
  relativeAge,
  roleLabel,
  serviceRows,
  strongestRole,
} from "@/app/members/view";

import {
  DEVOPS_BOT,
  JORGE,
  KEN,
  MAYA,
  MEMBERS_READ_AT,
  PRIYA,
  ago,
  membersPage,
} from "../helpers/members";

/**
 * The Members & Roles card's sentences and decisions (BS.3, #493), as pure functions: the
 * relative ages it never fabricates, the role mapping it sends, the last-owner rule it explains,
 * the row order the mockup draws and the Okta line it refuses to promise.
 */

const NOW = Date.parse(MEMBERS_READ_AT);

describe("relative ages", () => {
  it.each([
    [2, "now"],
    [41, "41s"],
    [12 * 60, "12m"],
    [2 * 3600, "2h"],
    [3 * 86_400, "3d"],
  ])("prints %ss ago as %s", (seconds, printed) => {
    expect(relativeAge(ago(seconds), NOW)).toBe(printed);
  });

  it("prints — for no timestamp, or one that does not parse — never a guess", () => {
    expect(relativeAge(null, NOW)).toBe(NEVER);
    expect(relativeAge("whenever", NOW)).toBe(NEVER);
  });

  it("does not print a future instant as negative", () => {
    expect(relativeAge(ago(-30), NOW)).toBe("now");
  });

  it("ages an invitation, and says when it expired", () => {
    expect(invitedAgo(PRIYA, NOW)).toBe("invited 2h ago");
    expect(invitedAgo({ ...PRIYA, invitedAt: ago(1) }, NOW)).toBe("invited just now");
    expect(invitedAgo({ ...PRIYA, expired: true }, NOW)).toBe("invited 2h ago · expired");
  });

  it("says when a token was last used, or that it never was", () => {
    expect(lastUsed(ago(41), NOW)).toBe("used 41s ago");
    expect(lastUsed(null, NOW)).toBe("never used");
  });
});

describe("roles", () => {
  it("offers Owner, Maintainer and Viewer — and Viewer sends viewer, never member", () => {
    expect(ROLE_CHOICES.map((choice) => [choice.label, choice.role])).toEqual([
      ["Owner", "owner"],
      ["Maintainer", "admin"],
      ["Viewer", "viewer"],
    ]);
  });

  it("maps a display role back to the choice it preselects", () => {
    expect(choiceOf("Owner")).toBe("owner");
    expect(choiceOf("Maintainer")).toBe("admin");
    expect(choiceOf("Viewer")).toBe("viewer");
  });

  it("labels each plugin role with decision S3's name", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => roleLabel(role as never))).toEqual([
      "Owner",
      "Maintainer",
      "Viewer",
      "Viewer",
    ]);
  });

  it("measures a change from the strongest role held", () => {
    expect(strongestRole(["member", "admin"])).toBe("admin");
    expect(strongestRole([])).toBe("viewer");
  });

  it("asks again only for a change that takes power away", () => {
    expect(demotionWarning("Maya Chen", "admin", "viewer")).toMatch(/Maintainer to Viewer at once/);
    expect(demotionWarning("Ken S", "owner", "admin")).toMatch(/Owner to Maintainer/);
    expect(demotionWarning("Jorge Reyes", "member", "admin")).toBeNull();
    expect(demotionWarning("Jorge Reyes", "member", "viewer")).toBeNull();
  });

  it("knows the last owner, and only while they are the only one", () => {
    expect(isLastOwner(KEN, [KEN, MAYA, JORGE])).toBe(true);
    expect(isLastOwner(KEN, [KEN, { ...MAYA, roles: ["owner"] }])).toBe(false);
    expect(isLastOwner(MAYA, [KEN, MAYA])).toBe(false);
  });
});

describe("the table's rows", () => {
  it("are people, then service accounts, then pending invitations — each keyed apart", () => {
    const rows = cardRows(
      [KEN, MAYA, JORGE],
      serviceRows(null, membersPage().serviceAccounts),
      [PRIYA],
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "member",
      "member",
      "member",
      "service",
      "invitation",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("draws a monogram from a name, and from an address", () => {
    expect(initials("Ken S")).toBe("KS");
    expect(initials("Maya Chen")).toBe("MC");
    expect(initials("priya@acme.dev")).toBe("P");
  });
});

describe("service rows", () => {
  it("take the hint and last use from an administrator's list", () => {
    expect(serviceRows([DEVOPS_BOT], [])).toEqual([
      {
        id: DEVOPS_BOT.id,
        name: "devops-bot",
        scopes: ["farm.submit", "api.read"],
        lastUsedAt: ago(41),
        hint: "orb_svc_••••ab12",
      },
    ]);
  });

  it("leave a revoked account out", () => {
    expect(serviceRows([{ ...DEVOPS_BOT, disabledAt: MEMBERS_READ_AT, token: null }], [])).toEqual([]);
  });

  it("carry no hint for a reader without the list", () => {
    const [row] = serviceRows(null, membersPage().serviceAccounts);

    expect(row.hint).toBeNull();
    expect(row.lastUsedAt).toBe(ago(41));
  });
});

describe("the footer's directory-sync line", () => {
  it("is absent until SCIM sync is real", () => {
    expect(directorySyncLine(null, NOW)).toBeNull();
  });

  it("states the real sync and when it last ran, once there is one", () => {
    expect(
      directorySyncLine(
        { provider: "Okta", groupPattern: "ouroboros-*", cadence: "nightly", lastSyncedAt: ago(3 * 3600) },
        NOW,
      ),
    ).toBe("Roles sync from Okta group ouroboros-* nightly ✓ · last synced 3h ago");
  });
});

describe("the capability's consequence", () => {
  it("names the inbox and the pull-request actions it grants, and that unticking removes them", () => {
    expect(CAPABILITY_CONSEQUENCE).toMatch(/Needs-You inbox/);
    expect(CAPABILITY_CONSEQUENCE).toMatch(/approving, waiving, arming and merging on pull requests/);
    expect(CAPABILITY_CONSEQUENCE).toMatch(/Unticking removes it at once/);
  });
});

describe("refusals", () => {
  it("say the service's sentence, or that nothing changed when there is none", () => {
    expect(refusalSentence("This is the workspace's last owner.")).toBe(
      "This is the workspace's last owner.",
    );
    expect(refusalSentence("  ")).toBe(WRITE_FAILED);
  });
});
