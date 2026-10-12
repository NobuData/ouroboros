import { SLACK_BOT_SCOPES } from "./slack.app";
import { linkConfirmPage, linkProblemPage, linkSignInPage, linkedPage } from "./slack.pages";
import { connectionResource } from "./slack.resources";

/**
 * The linking pages and the status resource (#535): every value escaped, nothing bound by a GET,
 * and a status that never carries the token.
 */

const SUBJECT = {
  slackWorkspace: "acme-robotics",
  slackName: "Maya Chen",
  slackUserId: "U07MAYA",
  workspace: "Acme Robotics",
  accountName: "Maya Chen",
  accountEmail: "maya@acme-robotics.dev",
  emailMatches: false,
};

describe("the linking pages", () => {
  it("escapes everything a Slack profile or an account could carry", () => {
    const hostile = '<script>alert("x")</script>';
    const page = linkConfirmPage({
      ...SUBJECT,
      slackName: hostile,
      slackWorkspace: hostile,
      accountName: hostile,
    });

    expect(page.html).not.toContain("<script>");
    expect(page.html).toContain("&lt;script&gt;");
  });

  it("confirms with a form that posts to itself and a button — no script, no external resource", () => {
    const { html, status } = linkConfirmPage(SUBJECT);

    expect(status).toBe(200);
    expect(html).toContain('<form method="post">');
    expect(html).toContain("Link this Slack identity");
    expect(html).not.toMatch(/<script|src=|href="http/);
  });

  it("shows the user id even when there is a display name — a name is a label", () => {
    expect(linkConfirmPage(SUBJECT).html).toContain("Maya Chen (U07MAYA)");
    expect(linkConfirmPage({ ...SUBJECT, slackName: null }).html).toContain(
      "<strong>U07MAYA</strong>",
    );
  });

  it("answers an anonymous GET 200 and an anonymous POST 401", () => {
    const input = { subject: SUBJECT, signInUrl: "https://app.example.test/login?next=%2Fx" };

    expect(linkSignInPage({ ...input, refused: false }).status).toBe(200);
    expect(linkSignInPage({ ...input, refused: true }).status).toBe(401);
    expect(linkSignInPage({ ...input, refused: true }).html).toContain("Nothing was linked");
  });

  it("tells the person how to undo it on the receipt", () => {
    expect(linkedPage(SUBJECT).html).toContain("/ouro unlink");
  });

  it.each([
    ["unknown", 404],
    ["expired", 410],
    ["not_member", 403],
    ["member_already_linked", 409],
    ["not_connected", 409],
  ] as const)("refuses %s with %i and says nothing was linked", (problem, status) => {
    const page = linkProblemPage(problem);

    expect(page.status).toBe(status);
    expect(page.html).toContain("Nothing was linked.");
  });
});

describe("the connection status resource", () => {
  const connection = {
    id: "c1",
    organization_id: "org-acme",
    platform: "slack" as const,
    workspace_id: "T024AB",
    workspace_name: "acme-robotics",
    bot_user_id: "U07OUROBOT",
    install_meta: {
      scopes: ["chat:write", "commands"],
      app_id: "A07OUROBOROS",
      app_version: "v1.0",
    },
    status: "active" as const,
    status_detail: null,
    installed_by: "user-ken",
    installed_at: new Date("2026-10-01T09:00:00Z"),
    last_verified_at: new Date("2026-10-12T14:00:00Z"),
    created_at: new Date("2026-10-01T09:00:00Z"),
    updated_at: new Date("2026-10-12T14:00:00Z"),
  };
  const base = { configured: true, channels: { total: 3, joined: 2 }, socketMode: false };

  it("reads connected, with the workspace, app version, granted scopes and what is missing", () => {
    expect(connectionResource({ ...base, connection })).toEqual({
      state: "connected",
      configured: true,
      installPath: "/api/v1/slack/oauth/install",
      connectionId: "c1",
      workspace: { id: "T024AB", name: "acme-robotics" },
      appId: "A07OUROBOROS",
      appVersion: "v1.0",
      scopes: ["chat:write", "commands"],
      missingScopes: SLACK_BOT_SCOPES.filter(
        (scope) => !["chat:write", "commands"].includes(scope),
      ),
      statusDetail: null,
      installedAt: "2026-10-01T09:00:00.000Z",
      lastVerifiedAt: "2026-10-12T14:00:00.000Z",
      channels: { total: 3, joined: 2 },
      socketMode: false,
    });
  });

  it("reads revoked with the platform's reason, and reports no missing scopes for a dead grant", () => {
    const answer = connectionResource({
      ...base,
      connection: { ...connection, status: "revoked", status_detail: "app_uninstalled" },
    });

    expect(answer).toMatchObject({
      state: "revoked",
      statusDetail: "app_uninstalled",
      missingScopes: [],
    });
  });

  it("distinguishes never installed from no app on the deployment", () => {
    expect(connectionResource({ ...base, connection: undefined }).state).toBe("not_connected");
    expect(connectionResource({ ...base, configured: false, connection: undefined })).toMatchObject(
      {
        state: "not_configured",
        installPath: null,
      },
    );
  });

  it("has no field a token could be in", () => {
    expect(Object.keys(connectionResource({ ...base, connection })).join(",")).not.toMatch(
      /token|secret|sealed/i,
    );
  });
});
