import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The repository root, two levels above this file (`ouroboros-docs/tests/`). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Reads a file of the repository.
 *
 * @param path the file's path segments, from the repository root.
 * @returns its text.
 */
function source(...path: string[]): string {
  return readFileSync(join(REPO_ROOT, ...path), "utf8");
}

/**
 * Reads one page of the Administration section, with its whitespace collapsed so a quoted
 * sentence may wrap over lines.
 *
 * @param name the page's file name under `ouroboros-docs/docs/administration/`.
 * @returns its text.
 */
function page(name: string): string {
  return source("ouroboros-docs", "docs", "administration", name).replace(/\s+/g, " ");
}

/** The overview page. */
const OVERVIEW = page("index.mdx");

/** The roles page. */
const ROLES = page("roles.mdx");

/** The sign-in & workspace settings page. */
const SIGN_IN = page("sign-in-and-workspace.mdx");

/** The members, invites, roles & API tokens page. */
const MEMBERS = page("members-and-tokens.mdx");

/** The ticket sources & repositories page. */
const SOURCES = page("sources.mdx");

/**
 * Reads the value of one exported string constant of the UI, joining a value written as
 * several `"…" +` pieces — e.g. `export const NOTE =\n  "One " +\n  "two.";`.
 *
 * @param file the file, from `ouroboros-ui/app/`.
 * @param name the constant's name.
 * @returns its value.
 * @throws {Error} when the file declares no such string constant.
 */
function constant(file: string, name: string): string {
  const text = source("ouroboros-ui", "app", ...file.split("/"));
  const match = new RegExp(`export const ${name} =\\s*((?:"[^"]*"\\s*\\+?\\s*)+);`).exec(text);
  if (!match) throw new Error(`${file} declares no string constant ${name}`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((piece) => piece[1]).join("");
}

/**
 * Lists every `*.controller.ts` file of the REST service, recursively.
 *
 * @param dir the directory to walk.
 * @returns absolute paths.
 */
function controllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return controllers(path);
    return entry.name.endsWith(".controller.ts") ? [path] : [];
  });
}

describe("the administration overview (#1189)", () => {
  it("names the settings hub's head as the page draws it", () => {
    for (const name of [
      "SETTINGS_TITLE",
      "SETTINGS_SUBLINE",
      "EXPORT_AUDIT_LABEL",
      "IMMEDIATE_MARK",
    ]) {
      expect(OVERVIEW).toContain(constant("settings/view.ts", name));
    }
  });

  it("lists every tab of the settings tab row, in its order", () => {
    const view = source("ouroboros-ui", "app", "settings", "view.ts");
    // The six section tabs, in TAB_ORDER, then the four mounted tabs.
    const order = /const TAB_ORDER[^=]*=\s*\[([^\]]+)\]/.exec(view)?.[1] ?? "";
    const ids = [...order.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    const tabs = ids.map((id) => {
      const tab = new RegExp(`id: "${id}",\\s*title: "[^"]+",\\s*tab: "([^"]+)"`).exec(view);
      if (!tab) throw new Error(`no tab for section ${id}`);
      return tab[1];
    });
    const mounted = /export const MOUNTED_TABS[\s\S]*?\];/.exec(view)?.[0] ?? "";
    tabs.push(...[...mounted.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]));
    expect(tabs).toHaveLength(10);

    const rows = [...OVERVIEW.matchAll(/\| \*\*([^*]+)\*\* \| [^|]+ \| \[/g)]
      .map((match) => match[1])
      .filter((label) => tabs.includes(label));
    expect(rows).toEqual(tabs);
  });

  it("quotes the read-only note as the hub words it", () => {
    expect(OVERVIEW).toContain(constant("settings/access.ts", "READ_ONLY_BODY"));
    expect(ROLES).toContain(constant("settings/access.ts", "READ_ONLY_BODY"));
  });

  it("shows the settings screenshot the issue lists", () => {
    expect(OVERVIEW).toContain('<Screenshot id="administration.settings" />');
  });
});

describe("the roles & capabilities page (#1189)", () => {
  it("offers the three roles the role picker offers, stored as the service stores them", () => {
    const view = source("ouroboros-ui", "app", "members", "view.ts");
    const choices = [...view.matchAll(/\{ label: "([A-Za-z]+)", role: "([a-z]+)", note:/g)].map(
      (match) => [match[1], match[2]],
    );
    expect(choices).toEqual([
      ["Owner", "owner"],
      ["Maintainer", "admin"],
      ["Viewer", "viewer"],
    ]);
    for (const [label, role] of choices) {
      expect(ROLES).toContain(`| **${label}** | \`${role}\` |`);
    }
  });

  it("prints the Members card's footer as the service builds it", () => {
    const roles = source("ouroboros-rest", "src", "modules", "members", "members.roles.ts");
    expect(roles).toContain('{ label: "Owner", roles: ["owner"] }');
    expect(roles).toContain('{ label: "Maintainer", roles: ["admin"] }');
    expect(roles).toContain('{ label: "Viewer", roles: ["member", "viewer"] }');
    expect(ROLES).toContain("**Owner > Maintainer (approve/merge) > Viewer (read-only)**");
  });

  it("documents the only capability there is, with the card's own words", () => {
    const capabilities = source("ouroboros-rest", "src", "modules", "tenancy", "capabilities.ts");
    expect(capabilities).toContain(
      'export const MEMBER_CAPABILITIES = ["can_approve_loops"] as const;',
    );
    expect(capabilities).toContain(
      'export const APPROVING_ROLES: readonly OrganizationRole[] = ["owner", "admin"];',
    );
    expect(source("ouroboros-ui", "app", "members", "view.ts")).toContain(
      'capability: "Can approve loops"',
    );
    expect(ROLES).toContain("**Can approve loops**");
    for (const name of ["CAPABILITY_CONSEQUENCE", "SERVICE_NO_CAPABILITY", "OWNER_ONLY_REASON"]) {
      expect(ROLES).toContain(constant("members/view.ts", name));
    }
    expect(ROLES).toContain(constant("inbox/card-view.ts", "NEEDS_APPROVER"));
  });

  it("names as approval answers exactly the inbox actions that need the capability", () => {
    const declarations = [
      source("ouroboros-db", "migrations", "V093__decision_kinds_items.sql"),
      source("ouroboros-db", "migrations", "V097__decision_kinds_mvp_source_resolved.sql"),
    ].join("\n");
    // Only the kinds something raises today — the inbox page's table lists those; a kind that is
    // declared but never raised (such as a spend approval) asks nobody anything.
    const inbox = source("ouroboros-docs", "docs", "user-guide", "inbox.mdx");
    const approver = new Set(
      [...declarations.matchAll(/"label": "([^"]+)"[^}]*"required_role": "approver"/g)]
        .map((match) => match[1])
        .filter((label) => inbox.includes(`**${label}**`)),
    );
    expect(approver.size).toBeGreaterThan(0);
    const named =
      /answer the approval decisions in the Needs-you inbox — (.*?);/.exec(ROLES)?.[1] ?? "";
    const labels = new Set([...named.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1]));
    expect(labels).toEqual(approver);
  });

  it("names delete and restore as the only owner-only routes", () => {
    const owners = controllers(join(REPO_ROOT, "ouroboros-rest", "src", "modules")).flatMap(
      (file) => {
        const text = readFileSync(file, "utf8");
        // Each handler's run of decorators, in whatever order they are written.
        return [...text.matchAll(/(?:@\w+\([^)]*\)\s*)+/g)]
          .map((block) => block[0])
          .filter((block) => block.includes('@Roles("owner")'))
          .map((block) => /@(?:Post|Put|Patch|Delete)\("([^"]+)"\)/.exec(block)?.[1] ?? block);
      },
    );
    expect(owners.sort()).toEqual(["delete", "restore"]);
    expect(ROLES).toContain("Owner to delete and restore");
  });

  it("quotes the refusals as the app words them", () => {
    for (const [file, name] of [
      ["members/view.ts", "LAST_OWNER_DEMOTE"],
      ["lifecycle/danger.ts", "DELETE_OWNER_ONLY"],
    ] as const) {
      expect(ROLES).toContain(constant(file, name));
    }
    for (const [file, sentence] of [
      [
        "policies/card-view.ts",
        "Not published — this edit loosens a rule, and only an owner can publish that.",
      ],
      [
        "audit-log/view.ts",
        "The audit log is read by owners and admins. Ask one of them for what you need from it.",
      ],
    ] as const) {
      expect(ROLES).toContain(sentence);
      expect(source("ouroboros-ui", "app", ...file.split("/"))).toContain(sentence);
    }
  });

  it("covers every section of the settings hub and every mounted tab", () => {
    const view = source("ouroboros-ui", "app", "settings", "view.ts");
    const titles = [...view.matchAll(/id: "[a-z]+",\s*title: "([^"]+)"/g)].map((match) => match[1]);
    expect(titles).toHaveLength(8);
    const mounted = /export const MOUNTED_TABS[\s\S]*?\];/.exec(view)?.[0] ?? "";
    const labels = [...mounted.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
    for (const name of [...titles, ...labels]) expect(ROLES).toContain(`| **${name}** |`);
  });

  it("carries no internal issue references or migration numbers in its prose", () => {
    for (const text of [OVERVIEW, ROLES, SIGN_IN, MEMBERS, SOURCES]) {
      const prose = text
        .replace(/^--- .*? --- /, "")
        .replace(/\*\*[^*]+\*\*/g, "")
        .replace(/`[^`]+`/g, "");
      expect(prose).not.toMatch(/#\d{2,}|\[[A-Z]{1,2}\.\d+\]|\bV\d{3}\b/);
    }
  });
});

describe("the sign-in & workspace settings page (#1192)", () => {
  /**
   * Reads a file of the REST service's source.
   *
   * @param path the file's path segments, from `ouroboros-rest/src/`.
   * @returns its text.
   */
  function rest(...path: string[]): string {
    return source("ouroboros-rest", "src", ...path);
  }

  it("lists the variables sign-in needs, each linked to the configuration reference", () => {
    const config = rest("modules", "config", "configuration.ts");
    for (const name of [
      "OURO_GITHUB_CLIENT_ID",
      "OURO_GITHUB_CLIENT_SECRET",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "OURO_UI_URL",
      "OURO_CORS_ORIGINS",
      "OURO_DATA_REGION",
    ]) {
      expect(config).toContain(`"${name}"`);
      expect(SIGN_IN).toContain(`<EnvVar name="${name}" />`);
    }
  });

  it("names the callback, scopes and secret length as the service configures them", () => {
    expect(rest("auth", "auth.options.ts")).toContain('export const AUTH_BASE_PATH = "/api/auth";');
    const github = rest("auth", "github.provider.ts");
    expect(github).toContain('export const GITHUB_PROVIDER_ID = "github";');
    expect(github).toContain('export const GITHUB_SCOPES = ["read:user", "user:email"] as const;');
    expect(SIGN_IN).toContain("`http://localhost:4000/api/auth/callback/github`");
    expect(SIGN_IN).toContain("`https://app.example.com/api/auth/callback/github`");
    expect(SIGN_IN).toContain("- `read:user`");
    expect(SIGN_IN).toContain("- `user:email`");

    expect(rest("modules", "config", "configuration.ts")).toContain(
      "export const MINIMUM_SECRET_LENGTH = 16;",
    );
    expect(SIGN_IN).toContain("At least 16 characters.");
  });

  it("states the session lifetime and refresh the service sets", () => {
    const session = rest("auth", "session.options.ts");
    expect(session).toContain("export const SESSION_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;");
    expect(session).toContain("export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;");
    expect(SIGN_IN).toContain("A session lasts seven days.");
    expect(SIGN_IN).toContain("at most once a day");
  });

  it("limits email and password to non-production, as both services do", () => {
    expect(rest("auth", "password.provider.ts")).toContain(
      'const enabled = configuration.nodeEnv !== "production";',
    );
    expect(source("ouroboros-ui", "app", "login", "sign-in-card.tsx")).toContain(
      'process.env.NODE_ENV !== "production" && <DevSignInForm />',
    );
    for (const dockerfile of ["ouroboros-rest", "ouroboros-ui"]) {
      expect(source(dockerfile, "Dockerfile")).toMatch(/ENV NODE_ENV=production/);
    }
    expect(SIGN_IN).toContain("`NODE_ENV=production`");
  });

  it("describes enterprise SSO as absent, quoting the answer every domain gets", () => {
    const discovery = rest("modules", "auth", "discovery.service.ts");
    const message = /export const NO_SSO_MESSAGE = "([^"]+)";/.exec(discovery)?.[1];
    expect(message).toBeDefined();
    expect(discovery).toContain("return { ssoAvailable: false, message: NO_SSO_MESSAGE };");
    expect(SIGN_IN).toContain(`*${message ?? ""}*`);
    expect(rest("modules", "settings", "workspace.sso.ts")).toContain(
      "return Promise.resolve(false);",
    );
    expect(SIGN_IN).toContain(constant("settings/workspace.ts", "SSO_ENFORCED_TAG"));
  });

  it("names the Workspace card's rows and sentences as the card draws them", () => {
    for (const name of [
      "NAME_LABEL",
      "DOMAIN_LABEL",
      "REGION_LABEL",
      "RETENTION_LABEL",
      "TRAINING_LABEL",
      "RESIDENCY_LINK",
    ]) {
      expect(SIGN_IN).toContain(`**${constant("settings/workspace.ts", name)}**`);
    }
    expect(SIGN_IN).toContain(constant("settings/workspace.ts", "DOMAIN_INVALID"));

    const card = source("ouroboros-ui", "app", "settings", "workspace.ts");
    for (const sentence of [
      "Changing it takes an owner or an admin.",
      "Self-hosted — single region. The operator has not named it (OURO_DATA_REGION).",
      "Off — this deployment never trains on your data.",
    ]) {
      expect(card).toContain(sentence);
      expect(SIGN_IN).toContain(sentence);
    }
    expect(card).toContain("export const NAME_MAX_LENGTH = 100;");
    expect(SIGN_IN).toContain("Up to 100 characters.");
    expect(rest("modules", "settings", "workspace.truth.ts")).toContain(
      'export const UNNAMED_REGION_LABEL = "self-hosted";',
    );
    expect(constant("settings/save-model.ts", "SAVE_LABEL")).toBe("Save changes");
    expect(SIGN_IN).toContain("**Save changes**");
  });

  it("quotes the domain refusal as the service words it", () => {
    const service = rest("modules", "settings", "workspace.service.ts");
    const message = /const DOMAIN_TAKEN_MESSAGE = "([^"]+)";/.exec(service)?.[1];
    expect(message).toBe("That domain belongs to another workspace.");
    expect(SIGN_IN).toContain(`*${message ?? ""}*`);
  });

  it("describes workspace recovery with the recovery screen's own words", () => {
    const recovery = source("ouroboros-ui", "app", "lifecycle", "recovery.ts");
    expect(recovery).toContain("is scheduled for deletion`;");
    expect(SIGN_IN).toContain("***Workspace* is scheduled for deletion**");
    expect(SIGN_IN).toContain(`**${constant("lifecycle/recovery.ts", "RESTORE_LABEL")}**`);
    expect(constant("lifecycle/recovery.ts", "WINDOW_UNKNOWN")).toBe("30-day recovery window");
    expect(SIGN_IN).toContain("30-day recovery window");
    expect(constant("lifecycle/recovery.ts", "NON_OWNER_NOTE")).toMatch(
      /^Only an owner of this workspace can restore it\./,
    );
    expect(SIGN_IN).toContain("*Only an owner of this workspace can restore it.*");
    expect(source("ouroboros-ui", "app", "paths.ts")).toContain('"/workspace-recovery"');
  });

  it("shows the screenshots the issue lists", () => {
    for (const id of ["administration.workspace", "administration.workspace.domain"]) {
      expect(SIGN_IN).toContain(`<Screenshot id="${id}" />`);
    }
  });
});

describe("the members, invites, roles & API tokens page (#1193)", () => {
  /** The members card's copy module. */
  const VIEW = "members/view.ts";

  it("names the card's controls and dialogs as the card draws them", () => {
    for (const name of [
      "MEMBERS_TITLE",
      "INVITE_LABEL",
      "INVITE_EMAIL",
      "INVITE_ROLE",
      "INVITE_SEND",
      "RESEND",
      "REVOKE",
      "MANAGE_TITLE",
      "ROLE_SAVE",
      "REMOVE_LABEL",
      "REMOVE_CONFIRM",
      "YOU_TAG",
      "SERVICE_TITLE",
      "SERVICE_CREATE",
      "SERVICE_NAME",
      "SERVICE_SCOPES",
      "SERVICE_SUBMIT",
      "TOKEN_TITLE",
      "TOKEN_DONE",
      "ROTATE",
      "ROTATE_CONFIRM",
      "REVOKE_CONFIRM",
    ]) {
      expect(MEMBERS).toContain(`**${constant(VIEW, name)}**`);
    }
    const view = source("ouroboros-ui", "app", ...VIEW.split("/"));
    expect(view).toContain('capability: "Can approve loops"');
    expect(view).toContain('lastActive: "Last active"');
    expect(view).toContain('member: "Member"');
    expect(view).toContain('role: "Role"');
    for (const column of ["Member", "Role", "Can approve loops", "Last active"]) {
      expect(MEMBERS).toContain(`| **${column}** |`);
    }
  });

  it("quotes the card's warnings and refusals in its own words", () => {
    for (const name of ["OWNER_ONLY_REASON", "LAST_OWNER_DEMOTE", "TOKEN_WARNING"]) {
      expect(MEMBERS).toContain(constant(VIEW, name));
    }
    const view = source("ouroboros-ui", "app", ...VIEW.split("/"));
    expect(view).toContain("return `Invitation sent to ${email}.`;");
    expect(view).toContain(
      "return `${name} goes from ${roleLabel(from)} to ${roleLabel(to)} at once, losing what that role allowed.`;",
    );
    expect(MEMBERS).toContain(
      "*Maya Chen goes from Maintainer to Viewer at once, losing what that role allowed.*",
    );
    expect(view).toContain(
      "return `${name} loses access to this workspace at once. Their audit history stays.`;",
    );
    expect(MEMBERS).toContain(
      "*Jorge Reyes loses access to this workspace at once. Their audit history stays.*",
    );
    expect(view).toContain('"3–40 lower-case letters, digits or hyphens, starting with a letter."');
    expect(MEMBERS).toContain("3–40 lower-case letters, digits or hyphens, starting with a letter");
  });

  it("offers the roles the invite picker offers, starting at Viewer", () => {
    const view = source("ouroboros-ui", "app", ...VIEW.split("/"));
    expect(view).toContain('export const DEFAULT_INVITE_ROLE: OrganizationRole = "viewer";');
    expect(MEMBERS).toContain("New invitations start as **Viewer**.");
    expect(MEMBERS).toContain("**The picker offers Owner, Maintainer and Viewer.**");
  });

  it("lists every scope a service account may hold, with the service's own description", () => {
    const scopes = source("ouroboros-rest", "src", "modules", "auth", "service.scopes.ts");
    expect(scopes).toContain('export const SERVICE_SCOPES = ["api.read", "farm.submit"] as const;');
    const described = [...scopes.matchAll(/^ {2}"([a-z.]+)": "([^"]+)",$/gm)];
    expect(described.map((match) => match[1])).toEqual(["api.read", "farm.submit"]);
    for (const [, scope, description] of described) {
      expect(MEMBERS).toContain(`| \`${scope}\` | ${description} |`);
    }
  });

  it("quotes the token refusals as the service words them", () => {
    const scopes = source("ouroboros-rest", "src", "modules", "auth", "service.scopes.ts");
    for (const sentence of [
      "This service token is not valid. It may have been rotated or revoked.",
      "Service accounts cannot call this route; it needs a person's session.",
    ]) {
      expect(scopes).toContain(`"${sentence}"`);
      expect(MEMBERS).toContain(`*${sentence}*`);
    }
    expect(scopes).toContain("`This service account lacks the ${scope} scope.`");
    expect(MEMBERS).toContain("*This service account lacks the farm.submit scope.*");
  });

  it("names the token prefix and header the service reads", () => {
    const principal = source("ouroboros-rest", "src", "modules", "auth", "service.principal.ts");
    expect(principal).toContain('export const SERVICE_TOKEN_PREFIX = "orb_svc_";');
    expect(MEMBERS).toContain("It starts with `orb_svc_`.");
    expect(constant(VIEW, "TOKEN_WARNING")).toContain("This is the only time this token is shown");
    expect(MEMBERS).toContain("`Authorization: Bearer <token>`");
    expect(MEMBERS).toContain(":::caution[The token is shown once]");
  });

  it("describes invitations as recorded but not delivered or accepted in the app", () => {
    // The day an accept screen or invitation mail ships, this page's warning must change.
    expect(source("ouroboros-rest", "src", "auth", "auth.routes.ts")).toContain(
      "**no email is sent**",
    );
    const ui = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : ui(path);
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
      });
    const accepting = ui(join(REPO_ROOT, "ouroboros-ui", "app")).filter((file) =>
      /accept-invitation|acceptInvitation/.test(readFileSync(file, "utf8")),
    );
    expect(accepting).toEqual([]);
    expect(MEMBERS).toContain(
      ":::warning[Invitations are not delivered or accepted in the app yet]",
    );
    expect(MEMBERS).toContain('fetch("/api/auth/organization/accept-invitation"');
  });

  it("states the invitation lifetime the service leaves at the library's default", () => {
    // No `invitationExpiresIn` anywhere in the service: the organization plugin's 48 hours apply.
    for (const file of ["auth.options.ts", "organization.plugin.ts"]) {
      expect(source("ouroboros-rest", "src", "auth", file)).not.toContain("invitationExpiresIn");
    }
    expect(MEMBERS).toContain("An invitation lasts 48 hours.");
  });

  it("shows the screenshots the issue lists", () => {
    for (const id of [
      "administration.members",
      "administration.members.invite",
      "administration.api-tokens.create",
    ]) {
      expect(MEMBERS).toContain(`<Screenshot id="${id}" />`);
    }
  });
});

describe("the ticket sources & repositories page (#1194)", () => {
  /**
   * Reads a file of the REST service's ticket-sources module.
   *
   * @param path the file's path segments, from `ouroboros-rest/src/modules/ticket-sources/`.
   * @returns its text.
   */
  function sources(...path: string[]): string {
    return source("ouroboros-rest", "src", "modules", "ticket-sources", ...path);
  }

  it("documents only the providers registered on main — GitHub — and the rest as coming soon", () => {
    expect(sources("ticket-sources.module.ts")).toContain(
      "useFactory: (github: GithubTicketSourceProvider): TicketSourceProvider[] => [github],",
    );
    const catalog = source("ouroboros-ui", "app", "sources", "catalog.ts");
    const soon = [...catalog.matchAll(/\{ kind: "[a-z]+", label: "([A-Za-z]+)", source:/g)].map(
      (match) => match[1],
    );
    expect(soon).toEqual(["Jira", "Linear", "GitLab"]);
    for (const label of soon) expect(SOURCES).toContain(`**${label}**`);
    expect(constant("catalog-tiles.ts", "COMING_SOON_LABEL")).toBe("coming soon");
    expect(constant("sources/catalog.ts", "V2_LABEL")).toBe("v2");
    expect(SOURCES).toContain("marked **coming soon** and **v2**");
  });

  it("describes the GitHub form with the provider's own titles and limits", () => {
    const config = sources("providers", "github.config.ts");
    for (const title of [
      "Connect a GitHub account",
      "GitHub account",
      "Repositories",
      "Personal access token",
    ]) {
      expect(config).toContain(`title: "${title}"`);
      expect(SOURCES).toContain(`**${title}**`);
    }
    expect(config).toContain("export const MAX_ENABLED_REPOS = 50;");
    expect(SOURCES).toContain("At least one, at most 50.");
  });

  it("says GitHub sources are polled, not sent webhooks", () => {
    expect(sources("providers", "github.provider.ts")).toMatch(/webhooks: false,/);
    expect(SOURCES).toContain("it does not\nreceive webhooks".replace("\n", " "));
  });

  it("names the page's controls and dialogs as the UI draws them", () => {
    for (const [file, name] of [
      ["sources/view.ts", "ADD_SOURCE_LABEL"],
      ["sources/view.ts", "TEST_LABEL"],
      ["sources/view.ts", "SYNC_LABEL"],
      ["sources/view.ts", "PAUSE_LABEL"],
      ["sources/view.ts", "RESUME_LABEL"],
      ["sources/view.ts", "CONFIGURE_LABEL"],
      ["sources/catalog.ts", "ADD_DIALOG_TITLE"],
      ["sources/catalog.ts", "NAME_LABEL"],
      ["sources/catalog.ts", "ADD"],
      ["sources/catalog.ts", "ADDED_TITLE"],
      ["sources/catalog.ts", "CONFIGURE_DIALOG_TITLE"],
      ["sources/catalog.ts", "SETTINGS_HEADING"],
      ["sources/catalog.ts", "SAVE"],
      ["sources/catalog.ts", "CREDENTIAL_HEADING"],
      ["sources/catalog.ts", "STORE_CREDENTIAL"],
    ] as const) {
      expect(SOURCES).toContain(`**${constant(file, name)}**`);
    }
    expect(SOURCES).toContain(constant("sources/states.ts", "READ_ONLY_BODY").split(". ")[0]);
    const catalog = source("ouroboros-ui", "app", "sources", "catalog.ts");
    for (const sentence of [
      "This workspace already has a source with that name.",
      "Some settings do not satisfy the provider's schema — see below.",
    ]) {
      expect(catalog).toContain(sentence);
      expect(SOURCES).toContain(`*${sentence}*`);
    }
  });

  it("explains every reason a sync can stop, in the service's words", () => {
    const errors = sources("ticket-source.errors.ts");
    const block = /TICKET_SOURCE_ERROR_REASONS[\s\S]*?\}\);/.exec(errors)?.[0] ?? "";
    const reasons = [...block.matchAll(/^ {4}[a-z_]+: "([^"]+)",$/gm)].map((match) => match[1]);
    expect(reasons).toHaveLength(6);
    for (const reason of reasons) expect(SOURCES).toContain(`| **${reason}** |`);
    expect(source("ouroboros-ui", "app", "sources", "view.ts")).toContain(
      "export const UNEXPLAINED_ERROR",
    );
  });

  it("says a source in error waits for someone to act, as the loop's filter does", () => {
    expect(sources("ticket-sources.repository.ts")).toContain('.where("status", "=", "active")');
    expect(sources("sources.service.ts")).toContain(
      'New settings, a new credential and an explicit\n * `status: "active"` all move an `error` source back to `active`',
    );
    expect(SOURCES).toContain("**A source in error is not synced again until you act.**");
  });

  it("offers no way to remove a source, and says so", () => {
    expect(sources("sources.controller.ts")).not.toMatch(/@Delete\(/);
    expect(SOURCES).toContain("A source cannot be removed from this page.");
  });

  it("documents the backlog token, which has an API but no screen", () => {
    const controller = source("ouroboros-rest", "src", "modules", "github", "github.controller.ts");
    expect(controller).toContain('@Controller("settings/github-token")');
    expect(controller).toContain("@Roles(...ADMINISTRATORS)");
    const tokens = source("ouroboros-rest", "src", "modules", "github", "github.token.ts");
    expect(tokens).toContain(
      'export const TOKEN_PREFIXES = ["github_pat_", "ghp_", "gho_", "ghu_", "ghs_", "ghr_"] as const;',
    );
    expect(SOURCES).toContain(
      "`github_pat_`,\n`ghp_`, `gho_`, `ghu_`, `ghs_` or `ghr_`".replace("\n", " "),
    );
    expect(SOURCES).toContain('curl -X PUT "$OURO_REST_URL/api/v1/settings/github-token"');
    // The day a screen sets it, this section must change.
    const ui = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : ui(path);
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
      });
    const setting = ui(join(REPO_ROOT, "ouroboros-ui", "app")).filter((file) =>
      readFileSync(file, "utf8").includes("settings/github-token"),
    );
    expect(setting).toEqual([]);
    expect(SOURCES).toContain("There is no screen for this token yet.");
  });

  it("names the one interval both syncs share", () => {
    expect(sources("sources.service.ts")).toContain(
      "pollIntervalSeconds: this.config.backlogSyncIntervalSeconds,",
    );
    expect(sources("ticket-sources.scheduler.ts")).toContain(
      "jittered(this.config.backlogSyncIntervalSeconds * 1000)",
    );
    expect(SOURCES).toContain('<EnvVar name="OURO_BACKLOG_SYNC_INTERVAL_SECONDS" />');
  });

  it("points the Issues page's token banners at the backlog token", () => {
    const issues = source("ouroboros-docs", "docs", "user-guide", "issues.mdx");
    expect(issues).toContain("../administration/sources.mdx#setting-the-backlog-token");
    expect(issues).not.toContain('adds a token under <UiPath path="Settings > Sources" />');
  });

  it("shows the screenshots the issue lists", () => {
    for (const id of [
      "administration.sources",
      "administration.sources.connect",
      "administration.sources.error",
    ]) {
      expect(SOURCES).toContain(`<Screenshot id="${id}" />`);
    }
  });
});
