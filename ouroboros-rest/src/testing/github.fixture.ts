/**
 * github.com, as a suite can hold it — the three endpoints an OAuth sign-in touches.
 *
 * [#715](https://github.com/NobuData/ouroboros/issues/715)'s third bullet: *GitHub callback
 * against a stubbed GitHub token/profile endpoint — no live credentials in CI.* This is that
 * stub, and what it stands in for is deliberately small.
 *
 * ## What is real, and what is not
 *
 * Everything except github.com. The `state` cookie, the code exchange's shape, the profile
 * read, the `mapProfileToUser` this service wrote, the account-linking policy, the
 * `"user"`/`account`/`session` rows and the personal organization
 * [#704](https://github.com/NobuData/ouroboros/issues/704)'s session hook creates are all the
 * genuine article, because the integration suite loads the real BetterAuth
 * (`jest.integration.config.mjs`). What is replaced is the far side of three HTTPS calls, for
 * the reason the issue gives: a suite that needed a real OAuth application could not run in
 * CI, and one that needed the internet could not run on an aeroplane.
 *
 * ## Why `fetch` rather than a provider override
 *
 * BetterAuth's GitHub provider hard-codes its three URLs — `github.com/login/oauth/…` and
 * `api.github.com/user{,/emails}` — and reaches them through `betterFetch`, which calls the
 * global `fetch`. There is a `getUserInfo` option, and taking it would have been the
 * convenient choice and the wrong one: it replaces the profile read *and the mapping around
 * it*, so `githubProfileToUser` — the one function in `github.provider.ts` this service
 * wrote — would stop being exercised by the very suite that exists to exercise it.
 *
 * Replacing `fetch` leaves the provider whole. The application under test runs in this
 * process, so its outbound calls come through here; Supertest's own requests do not, because
 * those cross a socket.
 *
 * ## It refuses everything it was not asked for
 *
 * An outbound call to any other URL throws, rather than falling through to the network. A
 * suite that quietly reached github.com would pass on a laptop, fail in CI, and take a
 * developer an afternoon to explain — so the failure is made immediate and is named.
 *
 * ```ts
 * const github = stubGithub({ profile: { login: "octocat", name: "The Octocat" } });
 * afterAll(() => github.restore());
 *
 * const person = await api.signInWithGithub(github);
 * expect(github.exchanges).toHaveLength(1);
 * ```
 *
 * Not shipped: `tsconfig.build.json` excludes `*.fixture.ts` alongside the specs.
 */

/** Where the code is exchanged for a token. BetterAuth's github provider hard-codes it. */
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/** Where the profile is read. Hard-coded in the provider as well. */
export const GITHUB_PROFILE_URL = "https://api.github.com/user";

/** Where the addresses are read — the call `user:email` is asked for. */
export const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

/** Where the browser is sent to authorize. Never fetched; asserted against. */
export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/**
 * A GitHub profile, as much of one as this service reads.
 *
 * `id` and `login` are GitHub's; `id` is what lands in `account.accountId`, which is the
 * column that makes a second sign-in the same person rather than a new one.
 */
export interface GithubProfileStub {
  /** The numeric account id, as GitHub serialises it. */
  readonly id: string;
  /** The handle. */
  readonly login: string;
  /** The display name, or `null` for an account that has set none. */
  readonly name: string | null;
  /** The avatar, or `null`. */
  readonly avatar_url: string | null;
  /** The public address, which is `null` for the majority of accounts. */
  readonly email: string | null;
}

/** One entry of `GET /user/emails`. */
export interface GithubEmailStub {
  /** The address. */
  readonly email: string;
  /** Whether it is the account's primary one. */
  readonly primary: boolean;
  /** Whether GitHub has verified it — the flag the account-linking policy turns on. */
  readonly verified: boolean;
  /** Whether the profile publishes it. */
  readonly visibility: "public" | "private";
}

/** What a suite tells the stub to be. */
export interface GithubStubOptions {
  /** The profile `GET /user` answers with. Partial; the rest is filled in. */
  readonly profile?: Partial<GithubProfileStub>;
  /**
   * The addresses `GET /user/emails` answers with.
   *
   * Defaults to one verified primary address derived from the login. A suite asserting the
   * account-linking policy passes an unverified one, which is the case the policy refuses.
   */
  readonly emails?: readonly GithubEmailStub[];
  /** The access token the exchange hands back. */
  readonly accessToken?: string;
  /**
   * Answer the code exchange with GitHub's own error shape instead of a token.
   *
   * `{ error: "bad_verification_code" }` at `200`, which is what github.com really does — it
   * does not use a status code for this — and is therefore the only way to assert that a
   * failed exchange ends as a redirect to the error page rather than as a session.
   */
  readonly tokenError?: string;
}

/** One call the application made to github.com. */
export interface GithubCall {
  /** Where it went. */
  readonly url: string;
  /** The verb. */
  readonly method: string;
  /** The `Authorization` header, when it carried one. */
  readonly authorization: string | null;
  /** The body, form-decoded, for the token exchange. Empty for the two reads. */
  readonly form: Readonly<Record<string, string>>;
}

/** The installed stub, and everything a suite asserts through it. */
export interface GithubStub {
  /** The profile it is answering with, complete. */
  readonly profile: GithubProfileStub;
  /** The addresses it is answering with. */
  readonly emails: readonly GithubEmailStub[];
  /** The address a completed sign-in should land on `"user"."email"`. */
  readonly primaryEmail: string;
  /** Every call the application made, in order. */
  readonly calls: readonly GithubCall[];
  /** Just the code exchanges — the ones that carry the client credentials. */
  readonly exchanges: readonly GithubCall[];
  /** Put the process's own `fetch` back. Safe to call twice. */
  restore(): void;
}

/** The address invented for a login when a suite does not name one. */
function defaultEmail(login: string): string {
  return `${login}@users.noreply.github.test`;
}

/**
 * Install the stub, replacing this process's `fetch` for the length of a suite.
 *
 * @param options - What GitHub should say. Every field has a default, so a suite that only
 *   cares that a sign-in completes passes nothing.
 * @returns The stub — the profile it settled on, the calls it recorded, and `restore`.
 */
export function stubGithub(options: GithubStubOptions = {}): GithubStub {
  const login = options.profile?.login ?? "octocat";
  const profile: GithubProfileStub = {
    id: "583231",
    login,
    name: "The Octocat",
    avatar_url: "https://avatars.githubusercontent.test/u/583231",
    email: null,
    ...options.profile,
  };
  const emails: readonly GithubEmailStub[] = options.emails ?? [
    { email: defaultEmail(login), primary: true, verified: true, visibility: "private" },
  ];
  const calls: GithubCall[] = [];
  const original = globalThis.fetch;
  let restored = false;

  // Typed off `fetch` itself rather than with `RequestInfo`: the DOM lib is not loaded here
  // — this service is Node — and Node 24's own `fetch` types do not export that name.
  globalThis.fetch = async (...[input, init]: Parameters<typeof fetch>) => {
    const request = new Request(input, init);
    // Read before the body is needed, because a `Request` body can only be read once and the
    // record has to hold what was sent whichever branch answers it.
    const body = request.method === "POST" ? await request.text() : "";

    calls.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      form: Object.fromEntries(new URLSearchParams(body)),
    });

    if (request.url === GITHUB_TOKEN_URL) {
      // GitHub answers a bad code with `200` and an error body, so the stub does too — see
      // `tokenError`. A status code here would be a shape the provider never has to handle.
      return json(
        options.tokenError === undefined
          ? {
              access_token: options.accessToken ?? "gho_stubbed_access_token",
              token_type: "bearer",
              scope: "read:user,user:email",
            }
          : { error: options.tokenError },
      );
    }

    if (request.url === GITHUB_PROFILE_URL) {
      return json(profile);
    }

    if (request.url === GITHUB_EMAILS_URL) {
      return json(emails);
    }

    throw new Error(
      `The application under test called ${request.method} ${request.url}, which this suite ` +
        "did not stub. Integration suites reach no network: add it to " +
        "src/testing/github.fixture.ts, or find out why the code is asking for it.",
    );
  };

  return {
    profile,
    emails,
    primaryEmail: (emails.find((each) => each.primary) ?? emails[0]).email,
    calls,
    get exchanges() {
      return calls.filter((call) => call.url === GITHUB_TOKEN_URL);
    },
    restore() {
      if (restored) {
        return;
      }

      restored = true;
      globalThis.fetch = original;
    },
  };
}

/**
 * A JSON response, as `betterFetch` expects to read one.
 *
 * @param body - What to serialise.
 * @returns The response.
 */
function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
