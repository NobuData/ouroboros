import { AUTH_BASE_PATH } from "../../auth/auth.options";
import { ACCOUNT_LINKING, GITHUB_PROVIDER_ID, GITHUB_SCOPES } from "../../auth/github.provider";
import { GITHUB_CALLBACK_PATH } from "../../auth/auth.routes";
import { SESSION_COOKIE } from "../../auth/session.options";
import {
  GITHUB_AUTHORIZE_URL,
  GITHUB_EMAILS_URL,
  GITHUB_PROFILE_URL,
  GITHUB_TOKEN_URL,
  stubGithub,
  type GithubStub,
} from "../../testing/github.fixture";
import { ApiHarness, AUTH, ORGS } from "../../testing/harness.fixture";
import { bodyOf, setCookie } from "../../testing/integration.fixture";
import { SCHEMA_NAME } from "../db/schema";

/**
 * **Continue with GitHub**, walked end to end — against a github.com this suite is holding.
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715)'s third bullet, and the criterion
 * [#702](https://github.com/NobuData/ouroboros/issues/702) had to leave as a manual check:
 * *the full browser flow against a real GitHub OAuth app*. It could not be automated then for
 * two reasons and this issue removes both — the integration suite now loads the real
 * BetterAuth, and `src/testing/github.fixture.ts` stands in for the far side of three HTTPS
 * calls so that no credential and no network are needed.
 *
 * What is being tested is everything on this side of those three calls, which is everything
 * this repository wrote or configured:
 *
 *   * **The authorization URL** — the scopes on the consent screen, the client id, and the
 *     `redirect_uri` an OAuth App has to be registered against. `github.provider.spec.ts`
 *     asserts the options object; this asserts the URL the library builds from it, which is
 *     the artefact github.com actually compares against.
 *   * **The exchange** — that the callback presents the configured client id and secret, and
 *     the same `redirect_uri`, at the endpoint the provider names.
 *   * **The profile mapping** — `githubProfileToUser`, reached through the library rather
 *     than called directly, including the fallback that keeps `"user"."name"` from being
 *     empty for an account that has set no name.
 *   * **The address**, and the `emailVerified` flag that goes with it — the profile's own
 *     when it publishes one, the verified primary from `GET /user/emails` when it does not,
 *     and the flag looked up by matching whichever was chosen against that list. That flag is
 *     the whole of what `ACCOUNT_LINKING` turns on, so the cases below are the policy as
 *     behaviour rather than as a comment.
 *   * **What lands in the database** — a `"user"` row, an `account` row keyed by GitHub's id,
 *     a `session`, and #704's personal organization.
 *
 * **The `state` is real.** Both hops are walked, so the callback presents a `state` the
 * authorization request issued and holds in a cookie. A suite that called the callback alone
 * would be testing it with its cross-site-request-forgery defence switched off.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** What `GET /api/auth/get-session` answers a signed-in caller with. */
interface SessionBody {
  /** The person, as the library resolved them. */
  readonly user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly image: string | null;
  };
}

/** An `ouroboros.account` row, as this suite reads one. */
interface AccountRow {
  /** `github`, for every row this suite creates. */
  readonly providerId: string;
  /** GitHub's own numeric id for the account. */
  readonly accountId: string;
  /** Whose it is. */
  readonly userId: string;
}

describe("continuing with GitHub", () => {
  let api: ApiHarness;
  let github: GithubStub;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());

  afterEach(async () => {
    // The stub first: it replaced this process's `fetch`, and leaving it installed would let
    // one test's github.com answer the next one's.
    github.restore();
    await api.truncate();
  });

  /**
   * Every GitHub account this suite has recorded.
   *
   * @returns The rows, over the suite's own connection.
   */
  async function accounts(): Promise<AccountRow[]> {
    const { rows } = await api.sql.query<AccountRow>(
      `select "providerId", "accountId", "userId" from ${SCHEMA_NAME}.account order by "createdAt"`,
    );

    return rows;
  }

  describe("the authorization request", () => {
    it("sends the browser to github.com, carrying this service's decisions", async () => {
      github = stubGithub();

      const response = await api
        .anonymous("post", `${AUTH}/sign-in/social`)
        .send({ provider: GITHUB_PROVIDER_ID, callbackURL: "/" })
        .expect(200);

      const url = new URL(bodyOf<{ url: string }>(response).url);

      expect(`${url.origin}${url.pathname}`).toBe(GITHUB_AUTHORIZE_URL);
      expect(url.searchParams.get("client_id")).toBe(api.configuration.githubClientId);
      // `GITHUB_CALLBACK_PATH` is the value an OAuth App is registered against, and this is
      // the one place the two can be compared: what the library sends, against what
      // `auth.routes.ts` publishes and the README tells somebody to type into github.com.
      expect(url.searchParams.get("redirect_uri")).toBe(
        `${api.configuration.betterAuthUrl}${GITHUB_CALLBACK_PATH}`,
      );
    });

    it("asks for the two scopes this service chose, each exactly once", async () => {
      // `disableDefaultScope` is what makes "exactly once" the assertion rather than a
      // detail: without it the library prepends its own defaults, which are the same two, and
      // the consent screen would carry `read:user user:email read:user user:email`.
      github = stubGithub();

      const response = await api
        .anonymous("post", `${AUTH}/sign-in/social`)
        .send({ provider: GITHUB_PROVIDER_ID, callbackURL: "/" })
        .expect(200);

      const scope = new URL(bodyOf<{ url: string }>(response).url).searchParams.get("scope") ?? "";

      expect(
        scope
          .split(/[\s,]+/)
          .filter(Boolean)
          .sort(),
      ).toEqual([...GITHUB_SCOPES].sort());
    });

    it("reaches github.com for nothing at all — it is a URL, not a call", async () => {
      github = stubGithub();

      await api
        .anonymous("post", `${AUTH}/sign-in/social`)
        .send({ provider: GITHUB_PROVIDER_ID, callbackURL: "/" })
        .expect(200);

      expect(github.calls).toEqual([]);
    });
  });

  describe("the callback", () => {
    it("exchanges the code at the provider's endpoint, with the configured credentials", async () => {
      github = stubGithub();

      await api.signInWithGithub(github, "the-code-github-sent");

      expect(github.exchanges).toHaveLength(1);
      expect(github.exchanges[0].form).toMatchObject({
        grant_type: "authorization_code",
        code: "the-code-github-sent",
        client_id: api.configuration.githubClientId,
        client_secret: api.configuration.githubClientSecret,
        redirect_uri: `${api.configuration.betterAuthUrl}${GITHUB_CALLBACK_PATH}`,
      });
      expect(github.exchanges[0].url).toBe(GITHUB_TOKEN_URL);
    });

    it("reads the profile and the addresses with the token it was given", async () => {
      github = stubGithub({ accessToken: "gho_a_particular_token" });

      await api.signInWithGithub(github);

      const reads = github.calls.filter((call) => call.method === "GET");
      expect(reads.map((call) => call.url)).toEqual([GITHUB_PROFILE_URL, GITHUB_EMAILS_URL]);
      for (const read of reads) {
        expect(read.authorization).toBe("Bearer gho_a_particular_token");
      }
    });

    it("touches nothing else on the internet", async () => {
      // The stub throws on an unstubbed URL, so this would already have failed loudly — the
      // assertion is here anyway, because "three calls" is the claim the issue's *no live
      // credentials in CI* rests on, and a fourth appearing is worth reading in a diff.
      github = stubGithub();

      await api.signInWithGithub(github);

      expect(github.calls).toHaveLength(3);
    });

    it("lands a session and sends the browser where it asked to go", async () => {
      github = stubGithub();

      const { status, location, cookie } = await api.signInWithGithub(github);

      expect(status).toBe(302);
      expect(location).toBe("/");
      expect(cookie).toContain(`${SESSION_COOKIE}=`);
    });

    it("writes the person, their GitHub account and their personal organization", async () => {
      github = stubGithub({ profile: { id: "1024", login: "maya-chen", name: "Maya Chen" } });

      const { cookie } = await api.signInWithGithub(github);
      const session = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(session.user).toMatchObject({
        name: "Maya Chen",
        email: github.primaryEmail,
        emailVerified: true,
      });
      expect(await accounts()).toEqual([
        { providerId: GITHUB_PROVIDER_ID, accountId: "1024", userId: session.user.id },
      ]);

      const { rows } = await api.sql.query<{ name: string; role: string }>(
        `select o."name", m."role"
           from ${SCHEMA_NAME}.member m
           join ${SCHEMA_NAME}.organization o on o."id" = m."organizationId"
          where m."userId" = $1`,
        [session.user.id],
      );
      expect(rows).toEqual([{ name: "Maya Chen", role: "owner" }]);
    });

    it("opens the rest of the API, which is the point of signing in at all", async () => {
      github = stubGithub();

      const { cookie } = await api.signInWithGithub(github);

      await api.anonymous("get", ORGS).set("Cookie", cookie).expect(200);
    });
  });

  describe("turning a profile into a person", () => {
    it("uses the name GitHub has, and the avatar", async () => {
      github = stubGithub({
        profile: { login: "octocat", name: "The Octocat", avatar_url: "https://avatars.test/1" },
      });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.name).toBe("The Octocat");
      expect(user.image).toBe("https://avatars.test/1");
    });

    // The fallback `githubProfileToUser` exists for, reached through the library. `"user"."name"`
    // is `not null`, and a blank one renders as nothing at all in a member list and in every
    // avatar monogram — a row that looks broken rather than a person who never filled in a
    // field. Whitespace is the case only an explicit `trim` catches.
    it.each([
      ["has set no name", null],
      ["has set a name of spaces", "   "],
    ])("falls back to the login for an account that %s", async (_what, name) => {
      github = stubGithub({ profile: { login: "octocat", name } });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.name).toBe("octocat");
    });

    it("stores no image at all when GitHub offered none, rather than an empty one", async () => {
      // `""` in `"user"."image"` is an `<img src="">`, which a browser resolves to the page
      // it is on and requests a second time. `undefined` is the value the adapter turns into
      // the nullable column's null.
      github = stubGithub({ profile: { login: "octocat", avatar_url: null } });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.image).toBeNull();
    });

    it("takes the primary address from GET /user/emails when the profile publishes none", async () => {
      // The common case, and the reason `user:email` is one of the two scopes: GitHub's
      // default is a private address, so the profile carries `email: null` and this call is
      // the only place the real one appears. Without the scope, a person whose colleague
      // invited them by that exact address would sign in as a stranger.
      github = stubGithub({
        profile: { login: "octocat", email: null },
        emails: [
          { email: "other@example.test", primary: false, verified: true, visibility: "public" },
          { email: "primary@example.test", primary: true, verified: true, visibility: "private" },
        ],
      });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.email).toBe("primary@example.test");
      expect(user.emailVerified).toBe(true);
    });

    it("keeps the profile's own address when it publishes one, and verifies it against the list", async () => {
      // The library's precedence, written down because it is the opposite of what the shape
      // of the code suggests: `GET /user/emails` is a *fallback*, consulted only when the
      // profile has no address. What the second call then decides either way is
      // `emailVerified` — it is looked up by matching the chosen address in the list.
      //
      // This is the half that matters for `ACCOUNT_LINKING`, which links on that flag and
      // nothing else. `mapProfileToUser` deliberately does not touch `email`, so nothing this
      // service wrote can override the pair.
      github = stubGithub({
        profile: { login: "octocat", email: "public@example.test" },
        emails: [
          { email: "public@example.test", primary: false, verified: true, visibility: "public" },
          { email: "primary@example.test", primary: true, verified: true, visibility: "private" },
        ],
      });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.email).toBe("public@example.test");
      expect(user.emailVerified).toBe(true);
    });

    it("marks an address the list does not vouch for as unverified", async () => {
      // A profile address that appears nowhere in `GET /user/emails` — which is what a
      // spoofed or stale profile looks like — resolves to `emailVerified: false`, and that is
      // the flag that stops it linking to somebody already here. The refusal itself is
      // asserted below, under *arriving as somebody the service already has a row for*.
      github = stubGithub({
        profile: { login: "octocat", email: "unvouched@example.test" },
        emails: [
          { email: "primary@example.test", primary: true, verified: true, visibility: "private" },
        ],
      });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.email).toBe("unvouched@example.test");
      expect(user.emailVerified).toBe(false);
    });
  });

  describe("coming back a second time", () => {
    it("is the same person, not a new one", async () => {
      // `account.accountId` is what makes that true — GitHub's own id, which survives a
      // rename of the login and of the display name.
      github = stubGithub({ profile: { id: "2048", login: "octocat" } });
      const first = await api.signInWithGithub(github);
      github.restore();

      github = stubGithub({ profile: { id: "2048", login: "octocat-renamed" } });
      const second = await api.signInWithGithub(github);

      const [before, after] = await Promise.all(
        [first.cookie, second.cookie].map(async (cookie) =>
          bodyOf<SessionBody>(
            await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
          ),
        ),
      );

      expect(after.user.id).toBe(before.user.id);
      expect(await accounts()).toHaveLength(1);
    });

    it("is a second session, so the first browser is unaffected", async () => {
      github = stubGithub({ profile: { id: "2048", login: "octocat" } });
      const first = await api.signInWithGithub(github);
      github.restore();

      github = stubGithub({ profile: { id: "2048", login: "octocat" } });
      const second = await api.signInWithGithub(github);

      expect(second.cookie).not.toBe(first.cookie);
      await api.anonymous("get", ORGS).set("Cookie", first.cookie).expect(200);
      await api.anonymous("get", ORGS).set("Cookie", second.cookie).expect(200);
    });
  });

  describe("arriving as somebody the service already has a row for", () => {
    it("links to them when GitHub has verified the address", async () => {
      // The case `ACCOUNT_LINKING` exists for, and the one that would otherwise strand an
      // invited person: a stub row is created days before their first sign-in, and without
      // linking they arrive as a stranger with the invitation pointing at the row they are
      // not.
      const invited = await api.signIn({ email: "maya@acme-robotics.test" });
      github = stubGithub({
        profile: { login: "maya-chen" },
        emails: [
          {
            email: "maya@acme-robotics.test",
            primary: true,
            verified: true,
            visibility: "private",
          },
        ],
      });

      const { cookie } = await api.signInWithGithub(github);
      const { user } = bodyOf<SessionBody>(
        await api.anonymous("get", `${AUTH}/get-session`).set("Cookie", cookie).expect(200),
      );

      expect(user.id).toBe(invited.id);
      expect((await accounts())[0].userId).toBe(invited.id);
    });

    it("does not link on an address GitHub has not verified", async () => {
      // `trustedProviders` is empty, so what authorises a link is GitHub having *proved* the
      // address rather than the provider being named as trustworthy. An unverified one is an
      // address somebody may merely have typed, and typing a colleague's is how an account
      // takeover starts. It is refused with a redirect to the error page and no session.
      expect(ACCOUNT_LINKING.trustedProviders).toEqual([]);

      const invited = await api.signIn({ email: "maya@acme-robotics.test" });
      github = stubGithub({
        profile: { login: "not-maya" },
        emails: [
          {
            email: "maya@acme-robotics.test",
            primary: true,
            verified: false,
            visibility: "private",
          },
        ],
      });

      const { status, location, cookie } = await api.signInWithGithub(github);

      expect(status).toBe(302);
      expect(location).toContain(`${AUTH_BASE_PATH}/error`);
      expect(cookie).not.toContain(`${SESSION_COOKIE}=`);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.session where "userId" = $1`,
        [invited.id],
      );
      // The one session is the fixture's own, from `signIn`; the handshake added none.
      expect(rows[0].count).toBe("1");
      expect(await accounts()).toEqual([]);
    });
  });

  describe("when the handshake fails", () => {
    it("ends at the error page, with no session, when github.com refuses the code", async () => {
      // GitHub answers a bad code with `200` and an error body rather than a status code, so
      // this is the shape the provider really has to handle — see the fixture's `tokenError`.
      github = stubGithub({ tokenError: "bad_verification_code" });

      const { status, location, cookie } = await api.signInWithGithub(github);

      expect(status).toBe(302);
      expect(location).toContain(`${AUTH_BASE_PATH}/error`);
      expect(cookie).not.toContain(`${SESSION_COOKIE}=`);
      expect(await accounts()).toEqual([]);
    });

    it("refuses a callback carrying no state at all", async () => {
      // The cross-site-request-forgery defence, asserted by removing it. Nothing is exchanged,
      // which is why this calls the callback directly rather than through the harness's
      // two-hop helper.
      github = stubGithub();

      const response = await api
        .anonymous("get", `${AUTH}/callback/${GITHUB_PROVIDER_ID}?code=whatever`)
        .redirects(0);

      expect(response.status).toBe(302);
      expect(String(response.headers.location)).toContain(`${AUTH_BASE_PATH}/error`);
      expect(setCookie(response, SESSION_COOKIE)).toBe("");
      expect(github.exchanges).toEqual([]);
    });

    it("refuses a state the browser was never issued", async () => {
      github = stubGithub();

      const response = await api
        .anonymous("get", `${AUTH}/callback/${GITHUB_PROVIDER_ID}?code=whatever&state=invented`)
        .redirects(0);

      expect(response.status).toBe(302);
      expect(String(response.headers.location)).toContain(`${AUTH_BASE_PATH}/error`);
      expect(github.exchanges).toEqual([]);
    });
  });
});
