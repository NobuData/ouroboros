import { testConfiguration } from "../modules/config/configuration.fixture";
import {
  ACCOUNT_LINKING,
  githubProfileToUser,
  githubProvider,
  GITHUB_PROVIDER_ID,
  GITHUB_SCOPES,
} from "./github.provider";

/**
 * The GitHub provider's four decisions, as data.
 *
 * Nothing here builds a BetterAuth instance or makes a request — the library is
 * ES-module-only and this runner is CommonJS, which is the reason `github.provider.ts`
 * imports it for types alone. That is not a limitation for this file: every value it asserts
 * on is one the library *reads*, and the two things it cannot settle from here are settled
 * where they can be. `@better-auth/cli generate` builds a real instance from
 * `auth.config.ts`, which is what proves these options are accepted at all; and the browser
 * flow against a real OAuth app is the manual check `README.md` § Signing in describes,
 * with [#715](https://github.com/NobuData/ouroboros/issues/715) owning the automated one.
 */

describe("the provider's id", () => {
  it("is the one string four other things have to agree with", () => {
    // The `socialProviders` key, the `/api/auth/callback/:id` segment the OAuth App is
    // registered against, the `account.providerId` value #706's back-fill wrote, and what
    // `ouroboros-ui` passes to `signIn.social`. Spelled once, here.
    expect(GITHUB_PROVIDER_ID).toBe("github");
  });
});

describe("the scopes", () => {
  it("asks for the profile and the addresses, and nothing else", () => {
    expect([...GITHUB_SCOPES]).toEqual(["read:user", "user:email"]);
  });

  it("asks for user:email, without which a private primary address is null", () => {
    // GitHub's default is a private address, so this is the common case rather than the
    // edge one: without the scope, somebody whose colleague invited them by that exact
    // address arrives as a stranger.
    expect(GITHUB_SCOPES).toContain("user:email");
  });

  it("asks for nothing that grants repository access", () => {
    // Reading a customer's code is ouroboros-engine's business, through a GitHub App with
    // its own installation grant. A consent screen for signing in must not ask for more
    // than signing in needs.
    for (const scope of GITHUB_SCOPES) {
      expect(scope).not.toMatch(/repo|workflow|admin|write|delete/);
    }
  });

  it("is the whole list, because the library's defaults are turned off", () => {
    // Without `disableDefaultScope` the library prepends its own pair and appends this one,
    // so every scope would be requested twice — and a library upgrade that widened its
    // defaults would widen this service's consent screen on a deploy.
    const provider = githubProvider(testConfiguration());

    expect(provider.disableDefaultScope).toBe(true);
    expect(provider.scope).toEqual([...GITHUB_SCOPES]);
  });

  it("hands over a copy, not the frozen constant", () => {
    const provider = githubProvider(testConfiguration());

    expect(provider.scope).not.toBe(GITHUB_SCOPES);
  });
});

describe("the OAuth application's credentials", () => {
  it("are the two variables #33 already read, so no deployment changes to land this", () => {
    const provider = githubProvider(
      testConfiguration({
        OURO_GITHUB_CLIENT_ID: "Iv1.0123456789abcdef",
        OURO_GITHUB_CLIENT_SECRET: "a-github-client-secret",
      }),
    );

    expect(provider.clientId).toBe("Iv1.0123456789abcdef");
    expect(provider.clientSecret).toBe("a-github-client-secret");
  });

  it("come from the configuration rather than from the environment", () => {
    // Nothing outside `src/modules/config/` names an environment variable (#28), so the
    // provider is built from a validated `Configuration` and cannot read one that was not.
    const provider = githubProvider(testConfiguration({ OURO_GITHUB_CLIENT_ID: "from-config" }));

    expect(provider.clientId).toBe("from-config");
  });

  it("is a fresh object each call", () => {
    const configuration = testConfiguration();

    expect(githubProvider(configuration)).not.toBe(githubProvider(configuration));
    expect(githubProvider(configuration)).toEqual(githubProvider(configuration));
  });
});

describe("turning a GitHub profile into a person", () => {
  it("uses the name they have set", () => {
    expect(
      githubProfileToUser({ login: "octocat", name: "Mona Lisa", avatar_url: "https://a/1" }),
    ).toEqual({ name: "Mona Lisa", image: "https://a/1" });
  });

  it.each([
    ["no name at all", undefined],
    ["a null name, which is what GitHub returns", null],
    ["an empty name", ""],
    ["a name that is only whitespace", "   "],
  ])("falls back to the login for %s", (_description, name) => {
    // `"user"."name"` is `not null`, and an empty string renders as nothing at all in a
    // member list and in every avatar fallback — a row that looks broken rather than a
    // person who never filled in a field. GitHub requires a login, so there is always
    // something to render.
    expect(githubProfileToUser({ login: "octocat", name })).toEqual({
      name: "octocat",
      image: undefined,
    });
  });

  it.each([
    ["no avatar", undefined],
    ["a null avatar", null],
    ["an empty avatar", ""],
  ])("leaves the image unset for %s", (_description, avatarUrl) => {
    // `undefined` rather than the empty string: `<img src="">` requests the page it is on.
    expect(githubProfileToUser({ login: "octocat", avatar_url: avatarUrl }).image).toBeUndefined();
  });

  it("does not touch the address", () => {
    // BetterAuth reads it from `GET /user/emails`, takes the verified primary, and sets
    // `emailVerified` from GitHub's own flag. Writing `email` here would override a
    // verified value with the public profile's unverified one.
    expect(Object.keys(githubProfileToUser({ login: "octocat" })).sort()).toEqual([
      "image",
      "name",
    ]);
  });

  it("is what the provider hands the library", () => {
    expect(githubProvider(testConfiguration()).mapProfileToUser).toBe(githubProfileToUser);
  });
});

describe("the account-linking policy", () => {
  it("is on, because an invited person must not arrive as a stranger", () => {
    // `MembersRepository.createUser` (#31) makes a stub row when somebody is invited to a
    // workspace. Without linking, their first sign-in creates a second row and the
    // invitation is left pointing at the one they are not.
    expect(ACCOUNT_LINKING.enabled).toBe(true);
  });

  it("trusts no provider by name, so a link needs a *verified* provider address", () => {
    // Naming `github` here would link an arriving account to an existing row on the
    // strength of the provider alone — including one whose address GitHub has not verified,
    // which is an address somebody may merely have typed. Empty, the library's condition
    // falls through to `userInfo.emailVerified`, which is the rule #33 enforced by hand.
    expect(ACCOUNT_LINKING.trustedProviders).toEqual([]);
    expect(ACCOUNT_LINKING.trustedProviders).not.toContain(GITHUB_PROVIDER_ID);
  });

  it("does not require the *local* address to have been verified", () => {
    // The local flag says whether this service has ever verified the address, and an
    // invited stub has never had the chance — #706's back-fill sets it false for exactly
    // those rows, truthfully. Leaving the library's default on would make the invitation
    // flow unusable.
    expect(ACCOUNT_LINKING.requireLocalEmailVerified).toBe(false);
  });

  it("does not allow a link across different addresses", () => {
    // Asserted by absence: `allowDifferentEmails` is not set, so the library's default
    // stands and a GitHub account can only attach to a row carrying the same address.
    // Setting it would make "same person" mean "same provider account", which is a claim
    // nothing here has checked.
    expect(ACCOUNT_LINKING).not.toHaveProperty("allowDifferentEmails");
  });

  it("states its whole surface, so a setting added here is a deliberate one", () => {
    expect(Object.keys(ACCOUNT_LINKING).sort()).toEqual([
      "enabled",
      "requireLocalEmailVerified",
      "trustedProviders",
    ]);
  });
});
