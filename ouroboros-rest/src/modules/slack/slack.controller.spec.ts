import type { AppConfigService } from "../config/config.service";
import type { Organization } from "../db/schema";
import type { Principal } from "../auth/principal";
import { SLACK_ERRORS, slackAlreadyConnected } from "./slack.errors";
import {
  OAUTH_STATE_COOKIE,
  SlackConnectionController,
  SlackOauthController,
  cookieOf,
  SlackLinkController,
  fromAnotherSite,
  linkSessionOf,
  stateCookie,
  stateMatches,
} from "./slack.controller";
import { FakeSlackStore, KEN, ORG, slackConfig } from "./slack.fixture";
import type { SlackInstallService } from "./slack.install.service";
import type { SlackLinkService } from "./slack.link.service";
import type { SlackRepository } from "./slack.repository";

/**
 * The browser-facing routes (#535): an install bound to the browser that began it, a callback
 * that always lands back in Settings, and the status every surface reads.
 */

const TENANT = { id: ORG } as Organization;
const PRINCIPAL = { user: { id: KEN.userId, name: KEN.name, email: KEN.email } } as Principal;

/** A response that records the headers it was given. */
function response() {
  const headers: Record<string, string> = {};

  return {
    headers,
    status: jest.fn(),
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  };
}

/** The OAuth controller over a stubbed install service. */
function oauth(installs: Partial<SlackInstallService> = {}, config: Record<string, unknown> = {}) {
  const authorizeUrl = jest.fn(
    (state: string) => `https://slack.com/oauth/v2/authorize?state=${state}`,
  );
  const service = { authorizeUrl, complete: jest.fn().mockResolvedValue({}), ...installs };

  return {
    service,
    authorizeUrl,
    controller: new SlackOauthController(
      service as unknown as SlackInstallService,
      slackConfig(config) as unknown as AppConfigService,
    ),
  };
}

describe("the state cookie", () => {
  it("is HttpOnly, scoped to the OAuth routes, short-lived and Lax — the callback is a navigation from slack.com", () => {
    expect(stateCookie("abc.org-acme", true)).toBe(
      `${OAUTH_STATE_COOKIE}=abc.org-acme; Path=/api/v1/slack/oauth; Max-Age=600; HttpOnly; SameSite=Lax; Secure`,
    );
  });

  it("is not Secure on a plain-http development origin, where the browser would drop it", () => {
    expect(stateCookie("abc.org-acme", false)).not.toContain("Secure");
  });

  it("clears itself with an empty value", () => {
    expect(stateCookie("", true)).toContain("Max-Age=0");
  });

  it("is read back out of a cookie header among others", () => {
    const request = { headers: { cookie: `a=1; ${OAUTH_STATE_COOKIE}=abc.org-acme; b=2` } };

    expect(cookieOf(request, OAUTH_STATE_COOKIE)).toBe("abc.org-acme");
    expect(cookieOf({ headers: {} }, OAUTH_STATE_COOKIE)).toBeUndefined();
  });
});

describe("stateMatches", () => {
  it("holds only when the cookie, the state and the workspace all agree", () => {
    expect(stateMatches("abc.org-acme", "abc", "org-acme")).toBe(true);
  });

  it.each([
    ["another state", "abc.org-acme", "xyz", "org-acme"],
    ["another workspace", "abc.org-acme", "abc", "org-other"],
    ["no cookie — the install did not start in this browser", undefined, "abc", "org-acme"],
    ["no state", "abc.org-acme", undefined, "org-acme"],
    ["an empty state", ".org-acme", "", "org-acme"],
  ])("fails for %s", (_label, cookie, state, organizationId) => {
    expect(stateMatches(cookie, state, organizationId)).toBe(false);
  });
});

describe("GET /slack/oauth/install", () => {
  it("redirects to Slack's consent screen and binds a fresh state to this browser and workspace", () => {
    const { controller, authorizeUrl } = oauth();
    const sent = response();

    const redirect = controller.install(TENANT, sent);
    const state = authorizeUrl.mock.calls[0][0];

    expect(redirect).toEqual({
      url: `https://slack.com/oauth/v2/authorize?state=${state}`,
      statusCode: 302,
    });
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(sent.headers["Set-Cookie"]).toContain(`${OAUTH_STATE_COOKIE}=${state}.${ORG}`);
    expect(sent.headers["Cache-Control"]).toBe("no-store");
  });

  it("issues a different state every time", () => {
    const { controller, authorizeUrl } = oauth();

    controller.install(TENANT, response());
    controller.install(TENANT, response());

    expect(authorizeUrl.mock.calls[0][0]).not.toBe(authorizeUrl.mock.calls[1][0]);
  });
});

describe("GET /slack/oauth/callback", () => {
  const cookie = { headers: { cookie: `${OAUTH_STATE_COOKIE}=abc.${ORG}` } };

  it("completes the install for the signed-in admin and lands in Settings as connected", async () => {
    const { controller, service } = oauth();
    const sent = response();

    const redirect = await controller.callback(
      TENANT,
      PRINCIPAL,
      "code-1",
      "abc",
      undefined,
      cookie,
      sent,
    );

    expect(service.complete).toHaveBeenCalledWith(ORG, KEN.userId, "code-1");
    expect(redirect).toEqual({
      url: "https://app.example.test/settings?slack=connected#integrations",
      statusCode: 302,
    });
    // The state is spent: the cookie is cleared whatever happened.
    expect(sent.headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it.each([
    ["a state that is not this browser's", "code-1", "forged", undefined, cookie],
    ["no state cookie at all", "code-1", "abc", undefined, { headers: {} }],
    ["no code", undefined, "abc", undefined, cookie],
  ])(
    "exchanges nothing for %s, and says so in Settings",
    async (_label, code, state, error, request) => {
      const { controller, service } = oauth();

      const redirect = await controller.callback(
        TENANT,
        PRINCIPAL,
        code,
        state,
        error,
        request,
        response(),
      );

      expect(service.complete).not.toHaveBeenCalled();
      expect(redirect.url).toBe(
        `https://app.example.test/settings?slack=${SLACK_ERRORS.stateInvalid}#integrations`,
      );
    },
  );

  it("lands in Settings with the reason when the person declined on Slack", async () => {
    const { controller, service } = oauth();

    const redirect = await controller.callback(
      TENANT,
      PRINCIPAL,
      undefined,
      "abc",
      "access_denied",
      cookie,
      response(),
    );

    expect(service.complete).not.toHaveBeenCalled();
    expect(redirect.url).toContain(`slack=${SLACK_ERRORS.installDenied}`);
  });

  it("carries the install's own refusal back to Settings rather than a JSON dead end", async () => {
    const { controller } = oauth({
      complete: jest.fn().mockRejectedValue(slackAlreadyConnected("acme-robotics")),
    });

    const redirect = await controller.callback(
      TENANT,
      PRINCIPAL,
      "code-1",
      "abc",
      undefined,
      cookie,
      response(),
    );

    expect(redirect.url).toContain(`slack=${SLACK_ERRORS.alreadyConnected}`);
  });

  it("lets an unexpected failure through as a failure", async () => {
    const { controller } = oauth({
      complete: jest.fn().mockRejectedValue(new Error("database is down")),
    });

    await expect(
      controller.callback(TENANT, PRINCIPAL, "code-1", "abc", undefined, cookie, response()),
    ).rejects.toThrow("database is down");
  });
});

describe("GET /slack/connection", () => {
  /** The status controller over a store. */
  function status(store: FakeSlackStore, configured = true) {
    return new SlackConnectionController(
      {
        credentials: () => (configured ? { clientId: "c", clientSecret: "s" } : undefined),
        verify: jest.fn().mockResolvedValue("verified"),
      } as unknown as SlackInstallService,
      store as unknown as SlackRepository,
      slackConfig() as unknown as AppConfigService,
    );
  }

  it("says not_configured on a deployment with no Slack app, and offers nothing to install", async () => {
    const answer = await status(new FakeSlackStore(), false).status(TENANT);

    expect(answer).toMatchObject({
      state: "not_configured",
      configured: false,
      installPath: null,
      workspace: null,
    });
  });

  it("says not_connected and where an admin starts the install", async () => {
    const answer = await status(new FakeSlackStore()).status(TENANT);

    expect(answer).toMatchObject({
      state: "not_connected",
      installPath: "/api/v1/slack/oauth/install",
      channels: { total: 0, joined: 0 },
    });
  });

  it("answers the verification result with the status after it", async () => {
    const answer = await status(new FakeSlackStore()).verify(TENANT);

    expect(answer.result).toBe("verified");
    expect(answer.connection.state).toBe("not_connected");
  });
});

describe("linkSessionOf", () => {
  it("is the signed-in person's id, name and email — or nothing for an anonymous request", () => {
    expect(linkSessionOf({ session: PRINCIPAL })).toEqual({
      userId: KEN.userId,
      name: KEN.name,
      email: KEN.email,
    });
    expect(linkSessionOf({})).toBeUndefined();
  });
});

describe("POST /slack/link/:token", () => {
  const TOKEN = `ouro_lnk_${"a".repeat(43)}`;
  const RECEIPT = { status: 200, html: "<p>linked</p>" };

  /** The controller over a link service that records whom it was asked to link. */
  function links() {
    const confirm = jest.fn().mockResolvedValue(RECEIPT);
    const controller = new SlackLinkController({ confirm } as unknown as SlackLinkService);

    return { controller, confirm };
  }

  it("links as the signed-in person when the browser posted the page's own form", async () => {
    const { controller, confirm } = links();
    const request = { session: PRINCIPAL, headers: { "sec-fetch-site": "same-origin" } };

    await expect(controller.submit(TOKEN, request, response())).resolves.toBe(RECEIPT.html);
    expect(confirm).toHaveBeenCalledWith(TOKEN, {
      userId: KEN.userId,
      name: KEN.name,
      email: KEN.email,
    });
  });

  it.each(["cross-site", "same-site"])(
    "links nobody when the post came from another site (%s), session or not",
    async (site) => {
      // Otherwise a form elsewhere could bind a signed-in person to an attacker's Slack identity.
      const { controller, confirm } = links();
      const request = { session: PRINCIPAL, headers: { "sec-fetch-site": site } };

      await controller.submit(TOKEN, request, response());

      expect(confirm).toHaveBeenCalledWith(TOKEN, undefined);
    },
  );

  it("leaves a client that sends no fetch metadata to the cookie's own rule", () => {
    expect(fromAnotherSite({ headers: {} })).toBe(false);
    expect(fromAnotherSite({ headers: { "sec-fetch-site": "none" } })).toBe(false);
    expect(fromAnotherSite({ headers: { "sec-fetch-site": "same-origin" } })).toBe(false);
  });
});
