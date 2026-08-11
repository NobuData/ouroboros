import { AppConfigService } from "../config/config.service";
import { testConfiguration } from "../config/configuration.fixture";
import { AUTH_ERRORS } from "./auth.errors";
import { GithubClient, GITHUB_API_VERSION, GITHUB_TIMEOUT_MS } from "./github";
import { GITHUB_API_URL, GITHUB_TOKEN_URL } from "./oauth";
import type { DomainError } from "../errors/error.envelope";

/**
 * The GitHub side of sign-in, against responses this file constructs.
 *
 * The interesting cases are all failures, and they are interesting because GitHub does not
 * fail the way an HTTP client expects: its token endpoint answers `200` with an `error`
 * field, and its `GET /user` returns an address only for the minority of accounts that
 * publish one. Both are here, along with the rule that nothing GitHub says reaches a client.
 */

const CONFIG = new AppConfigService({
  getOrThrow: (key: string) =>
    testConfiguration()[key as keyof ReturnType<typeof testConfiguration>],
  get: (key: string) => testConfiguration()[key as keyof ReturnType<typeof testConfiguration>],
} as never);

/** One call the fake `fetch` will answer, in the order the client makes them. */
interface Answer {
  status?: number;
  body?: unknown;
  /** Reject instead of answering — a refused connection, a DNS failure, a deadline. */
  fail?: boolean;
}

/** What a fake `fetch` recorded. */
interface Recorded {
  url: string;
  init: RequestInit;
}

/**
 * A `fetch` that answers from a queue and writes down what it was asked.
 *
 * @param answers - One per call, in order. A call past the end answers `200 {}`.
 * @returns The fake, and the record.
 */
function recordingFetch(...answers: Answer[]): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let index = 0;

  const impl = (url: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    // `GithubClient` only ever calls with a string, so this narrows rather than
    // stringifies — `String(request)` would record `[object Object]` and assert nothing.
    calls.push({ url: url as string, init });
    const answer = answers[index++] ?? { status: 200, body: {} };

    if (answer.fail === true) {
      return Promise.reject(new TypeError("fetch failed"));
    }

    return Promise.resolve(
      new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };

  return { fetch: impl, calls };
}

/** The `GET /user` body of an account with everything set. */
const USER_BODY = {
  id: 900_000_001,
  login: "ksuenobu",
  name: "Ken Suenobu",
  email: null,
  avatar_url: "https://avatars.githubusercontent.com/u/900000001",
};

/** The `GET /user/emails` body of the same account. */
const EMAIL_BODY = [
  { email: "other@example.test", primary: false, verified: true },
  { email: "Ken@Acme-Robotics.dev", primary: true, verified: true },
];

/**
 * The envelope code a rejection carries.
 *
 * @param work - The call that is expected to fail.
 * @returns Its `code`. Asserting on that rather than on a class is what keeps these tests
 *   about the answer a client gets rather than about this module's inheritance.
 * @throws {Error} If the call succeeded, which is a failing test rather than a passing one.
 */
async function codeOfRejection(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return (error as DomainError).code;
  }

  throw new Error("the call was expected to fail and did not");
}

describe("exchanging a code", () => {
  it("posts the credentials, the code, the redirect URI and the PKCE verifier", async () => {
    const { fetch, calls } = recordingFetch({ body: { access_token: "gho_token" } });

    await new GithubClient(CONFIG, fetch).exchangeCode("the-code", "the-verifier", "http://cb");

    expect(calls[0].url).toBe(GITHUB_TOKEN_URL);
    expect(calls[0].init.method).toBe("POST");

    const body = calls[0].init.body as URLSearchParams;
    expect(body.get("client_id")).toBe("dev-github-client-id");
    expect(body.get("client_secret")).toBe("dev-github-client-secret");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("code_verifier")).toBe("the-verifier");
    expect(body.get("redirect_uri")).toBe("http://cb");
  });

  it("asks for JSON, because a token parsed out of a query string is a token one bug from wrong", async () => {
    const { fetch, calls } = recordingFetch({ body: { access_token: "gho_token" } });

    await new GithubClient(CONFIG, fetch).exchangeCode("c", "v", "http://cb");

    expect((calls[0].init.headers as Record<string, string>).accept).toBe("application/json");
  });

  it("returns the token", async () => {
    const { fetch } = recordingFetch({ body: { access_token: "gho_token" } });

    expect(await new GithubClient(CONFIG, fetch).exchangeCode("c", "v", "http://cb")).toBe(
      "gho_token",
    );
  });

  it("refuses a 200 that carries an error instead of a token — which is how GitHub says no", async () => {
    const { fetch } = recordingFetch({ status: 200, body: { error: "bad_verification_code" } });

    expect(
      await codeOfRejection(new GithubClient(CONFIG, fetch).exchangeCode("c", "v", "http://cb")),
    ).toBe(AUTH_ERRORS.githubUnavailable);
  });

  it.each([
    ["a refused connection", { fail: true }],
    ["a 500 from GitHub", { status: 500 }],
    ["a 401 from GitHub", { status: 401 }],
    ["a body that is not JSON", { status: 200, body: undefined }],
  ])("answers github_unavailable for %s", async (_description, answer) => {
    const { fetch } = recordingFetch(answer);

    expect(
      await codeOfRejection(new GithubClient(CONFIG, fetch).exchangeCode("c", "v", "http://cb")),
    ).toBe(AUTH_ERRORS.githubUnavailable);
  });

  it("bounds the call, so a slow GitHub is not a request that never answers", async () => {
    const { fetch, calls } = recordingFetch({ body: { access_token: "t" } });

    await new GithubClient(CONFIG, fetch).exchangeCode("c", "v", "http://cb");

    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(GITHUB_TIMEOUT_MS).toBe(10_000);
  });
});

describe("reading a profile", () => {
  it("reads the account and then its addresses", async () => {
    const { fetch, calls } = recordingFetch({ body: USER_BODY }, { body: EMAIL_BODY });

    await new GithubClient(CONFIG, fetch).readProfile("gho_token");

    expect(calls.map((call) => call.url)).toEqual([
      `${GITHUB_API_URL}/user`,
      `${GITHUB_API_URL}/user/emails`,
    ]);
  });

  it("carries the token and pins the API version", async () => {
    const { fetch, calls } = recordingFetch({ body: USER_BODY }, { body: EMAIL_BODY });

    await new GithubClient(CONFIG, fetch).readProfile("gho_token");

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer gho_token");
    expect(headers["x-github-api-version"]).toBe(GITHUB_API_VERSION);
  });

  it("returns the immutable id as a string, not the renameable login", async () => {
    const { fetch } = recordingFetch({ body: USER_BODY }, { body: EMAIL_BODY });

    const profile = await new GithubClient(CONFIG, fetch).readProfile("gho_token");

    expect(profile.externalId).toBe("900000001");
    expect(profile.login).toBe("ksuenobu");
  });

  it("prefers the verified primary address, lower-cased", async () => {
    const { fetch } = recordingFetch({ body: USER_BODY }, { body: EMAIL_BODY });

    // Folded to match `ouroboros.users.email`'s storage rule: a differently-cased address
    // would miss the unique index and put one person into the product twice.
    expect((await new GithubClient(CONFIG, fetch).readProfile("gho_token")).email).toBe(
      "ken@acme-robotics.dev",
    );
  });

  it("falls back to another verified address when none is primary", async () => {
    const { fetch } = recordingFetch(
      { body: USER_BODY },
      { body: [{ email: "only@example.test", primary: false, verified: true }] },
    );

    expect((await new GithubClient(CONFIG, fetch).readProfile("gho_token")).email).toBe(
      "only@example.test",
    );
  });

  it("never accepts an unverified address", async () => {
    // An address nobody proved control of is an address somebody else may hold — and this
    // is what decides which `users` row, and so which invitations, the person lands on.
    const { fetch } = recordingFetch(
      { body: USER_BODY },
      { body: [{ email: "unverified@example.test", primary: true, verified: false }] },
    );

    expect(await codeOfRejection(new GithubClient(CONFIG, fetch).readProfile("gho_token"))).toBe(
      AUTH_ERRORS.emailUnavailable,
    );
  });

  it("uses the public address only when the list offers nothing", async () => {
    const { fetch } = recordingFetch(
      { body: { ...USER_BODY, email: "Public@example.test" } },
      { body: [] },
    );

    expect((await new GithubClient(CONFIG, fetch).readProfile("gho_token")).email).toBe(
      "public@example.test",
    );
  });

  it("answers github_email_unavailable when there is no address at all", async () => {
    const { fetch } = recordingFetch({ body: USER_BODY }, { body: [] });

    expect(await codeOfRejection(new GithubClient(CONFIG, fetch).readProfile("gho_token"))).toBe(
      AUTH_ERRORS.emailUnavailable,
    );
  });

  it("falls back to the login when the account has set no name", async () => {
    const { fetch } = recordingFetch({ body: { ...USER_BODY, name: null } }, { body: EMAIL_BODY });

    expect((await new GithubClient(CONFIG, fetch).readProfile("gho_token")).displayName).toBe(
      "ksuenobu",
    );
  });

  it("keeps a null avatar null rather than inventing a placeholder", async () => {
    const { fetch } = recordingFetch(
      { body: { ...USER_BODY, avatar_url: null } },
      { body: EMAIL_BODY },
    );

    expect((await new GithubClient(CONFIG, fetch).readProfile("gho_token")).avatarUrl).toBeNull();
  });

  it.each([
    ["no id", { ...USER_BODY, id: undefined }],
    ["an id that is not a number", { ...USER_BODY, id: "900000001" }],
    ["no login", { ...USER_BODY, login: "" }],
  ])("answers github_unavailable for an account with %s", async (_description, body) => {
    const { fetch } = recordingFetch({ body }, { body: EMAIL_BODY });

    expect(await codeOfRejection(new GithubClient(CONFIG, fetch).readProfile("gho_token"))).toBe(
      AUTH_ERRORS.githubUnavailable,
    );
  });
});

describe("what a client is told", () => {
  it("never repeats what GitHub said", async () => {
    const { fetch } = recordingFetch({
      status: 422,
      body: { message: "Bad credentials for client 0123456789abcdef", documentation_url: "…" },
    });

    const failure = await new GithubClient(CONFIG, fetch).exchangeCode("c", "v", "http://cb").then(
      () => {
        throw new Error("the exchange was expected to fail and did not");
      },
      (error: unknown) => error as DomainError,
    );

    // GitHub's error bodies are written for whoever holds the OAuth application, and have
    // carried request identifiers and echoed parameters. None of it is this API's contract.
    expect(failure.message).not.toContain("0123456789abcdef");
    expect(failure.message).not.toContain("Bad credentials");
    expect(failure.getStatus()).toBe(502);
  });
});
