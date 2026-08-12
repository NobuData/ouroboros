import {
  PERSONAL_ORGANIZATION_METADATA,
  PERSONAL_ORGANIZATION_METADATA_JSON,
  SLUG_MAX_LENGTH,
  activeOrganizationHooks,
  chooseActiveOrganization,
  personalOrganizationName,
  personalOrganizationSlugs,
  resolveActiveOrganization,
  slugify,
  stampActiveOrganization,
  type OrganizationStore,
} from "./active.organization";

/**
 * Where a session starts out acting, and the personal organization that gives it somewhere
 * to be.
 *
 * Two of [#704](https://github.com/NobuData/ouroboros/issues/704)'s acceptance criteria:
 * *a new GitHub sign-in yields a personal organization and a membership row*, and a session
 * row that carries the pointer `setActiveOrganization` later changes.
 *
 * The adapter is a fake, and it is a fake of a **two-method interface this module declared
 * itself** rather than of BetterAuth's `DBAdapter` — see `OrganizationStore`. That is what
 * lets these assertions be about the rule (what is read, what is written, in what order,
 * and what happens when a write is refused) rather than about a mock of a library.
 */

/** A row the fake store has written, as it was asked to write it. */
interface WrittenRow {
  readonly model: string;
  readonly data: Record<string, unknown>;
}

/** What {@link fakeStore} is set up with. */
interface FakeStoreOptions {
  /** Memberships the person already holds, oldest first. */
  readonly memberships?: { organizationId: string }[];
  /** Slugs an insert into `organization` must be refused for — the unique index, in effect. */
  readonly takenSlugs?: string[];
}

/** A store that records what it was asked to do, and refuses the slugs it was told to. */
function fakeStore({ memberships = [], takenSlugs = [] }: FakeStoreOptions = {}): {
  store: OrganizationStore;
  written: WrittenRow[];
  reads: number;
} {
  const written: WrittenRow[] = [];
  const state = { reads: 0 };
  let minted = 0;

  // Written as plain functions returning promises rather than as `async` ones: neither
  // awaits anything, and a rejected promise is a truer stand-in for a refused insert than a
  // synchronous `throw` inside an async wrapper would be.
  const store: OrganizationStore = {
    findMany<T>(): Promise<T[]> {
      state.reads += 1;
      return Promise.resolve(memberships as T[]);
    },
    create<T>({ model, data }: { model: string; data: Record<string, unknown> }): Promise<T> {
      // The unique index on `organization.slug`, as the adapter would surface it: a
      // rejection, not a null.
      if (model === "organization" && takenSlugs.includes(String(data.slug))) {
        return Promise.reject(
          new Error(`duplicate key value violates unique constraint "organization_slug_key"`),
        );
      }

      written.push({ model, data });
      minted += 1;

      return Promise.resolve({ id: `minted-${minted}`, ...data } as T);
    },
  };

  return {
    store,
    written,
    get reads() {
      return state.reads;
    },
  };
}

/** The person a personal organization is being made for. */
const KEN = { id: "user-1", name: "Ken Suenobu", email: "ken@acme-robotics.dev" };

describe("naming a personal organization", () => {
  it("uses the person's own name, which is what mockup 01 Step 2 shows", () => {
    expect(personalOrganizationName(KEN)).toBe("Ken Suenobu");
  });

  it("falls back to the local part of their address when they have set no name", () => {
    // `"user"."name"` is `not null` but is not guaranteed to be useful — an invited stub
    // (#31) has whatever the invitation carried.
    expect(personalOrganizationName({ id: "u", name: null, email: "maya@globex.example" })).toBe(
      "maya",
    );
  });

  it("treats a whitespace-only name as no name at all", () => {
    // The same rule `githubProfileToUser` applies, for the same reason: three spaces render
    // as nothing, which looks like a broken row rather than a person.
    expect(personalOrganizationName({ id: "u", name: "   ", email: "jorge@globex.example" })).toBe(
      "jorge",
    );
  });

  it("never returns blank, because organization.name is not null", () => {
    expect(personalOrganizationName({ id: "u" })).toBe("Personal");
    expect(personalOrganizationName({ id: "u", name: "", email: "" })).toBe("Personal");
  });
});

describe("slugify", () => {
  it("produces the DNS-label shape V001 constrained tenants.slug to", () => {
    expect(slugify("Ken Suenobu")).toBe("ken-suenobu");
    expect(slugify("Acme Robotics, Inc.")).toBe("acme-robotics-inc");
  });

  it("collapses runs and trims the ends, so no slug starts or ends with a hyphen", () => {
    expect(slugify("  --Acme   ///  Robotics-- ")).toBe("acme-robotics");
  });

  it("bounds the result at a DNS label, without leaving a trailing hyphen behind", () => {
    // The truncation is what could produce one: cutting `…-x` mid-word leaves `…-`, which
    // is the one shape a DNS label may not end with.
    const long = slugify(`${"a".repeat(SLUG_MAX_LENGTH)} tail`);

    expect(long).toHaveLength(SLUG_MAX_LENGTH);
    expect(long.endsWith("-")).toBe(false);
  });

  it("renders a name in a non-Latin script to nothing, which the caller handles", () => {
    // A limitation named rather than hidden — see the function's own comment on why
    // transliteration is not attempted.
    expect(slugify("日本語")).toBe("");
  });
});

describe("choosing a slug for a personal organization", () => {
  it("prefers the readable one and keeps an id-derived fallback behind it", () => {
    // `organization.slug` is unique across the installation, so the readable slug belongs to
    // whoever gets there first; the second candidate is what the next person called Ken
    // gets, without a loop or a counter.
    expect(personalOrganizationSlugs(KEN)).toEqual(["ken-suenobu", "ken-suenobu-user-1"]);
  });

  it("skips straight to the fallback when the name slugifies to nothing usable", () => {
    expect(personalOrganizationSlugs({ id: "abcdef123456", name: "日本語" })).toEqual([
      "personal-abcdef12",
    ]);
  });

  it("keeps even the suffixed candidate inside a DNS label", () => {
    const [, suffixed] = personalOrganizationSlugs({
      id: "0123456789abcdef",
      name: "N".repeat(200),
    });

    expect(suffixed?.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });
});

describe("choosing which organization a session starts in", () => {
  it("takes the earliest membership, which for a new person is their personal one", () => {
    expect(
      chooseActiveOrganization([{ organizationId: "org-a" }, { organizationId: "org-b" }]),
    ).toBe("org-a");
  });

  it("answers null for somebody who belongs to none", () => {
    // A valid session: signed in, acting nowhere. `V005`'s column is nullable for exactly
    // this, and mockup 01 Step 2 renders it as an empty list rather than an error.
    expect(chooseActiveOrganization([])).toBeNull();
  });
});

describe("resolving the active organization", () => {
  it("writes nothing when the person already belongs somewhere", () => {
    // The common case, and it has to stay cheap: one indexed lookup on every sign-in for
    // everybody who has signed in before, or been migrated by #708, or been invited.
    const { store, written } = fakeStore({ memberships: [{ organizationId: "org-existing" }] });

    return resolveActiveOrganization({ store, user: KEN }).then((resolved) => {
      expect(resolved).toBe("org-existing");
      expect(written).toHaveLength(0);
    });
  });

  it("makes somebody an organization of their own when they belong to none", async () => {
    const { store, written } = fakeStore();

    const resolved = await resolveActiveOrganization({ store, user: KEN });

    expect(resolved).toBe("minted-1");
    expect(written.map((row) => row.model)).toEqual(["organization", "member"]);
    expect(written[0]?.data).toMatchObject({ name: "Ken Suenobu", slug: "ken-suenobu" });
  });

  it("flags it as personal, as the text the column actually holds", () => {
    // `organization.metadata` is JSON held as *text*, and this module writes through the
    // adapter rather than through the plugin's routes — so it stringifies itself. Passing
    // the object would store `[object Object]`, which `V005`'s `organization_metadata_is_json`
    // check refuses outright.
    const { store, written } = fakeStore();

    return resolveActiveOrganization({ store, user: KEN }).then(() => {
      expect(written[0]?.data.metadata).toBe(PERSONAL_ORGANIZATION_METADATA_JSON);
      expect(typeof written[0]?.data.metadata).toBe("string");
      expect(JSON.parse(String(written[0]?.data.metadata))).toEqual(PERSONAL_ORGANIZATION_METADATA);
    });
  });

  it("makes them its owner, which is the role nobody else could grant them", async () => {
    const { store, written } = fakeStore();

    await resolveActiveOrganization({ store, user: KEN });

    expect(written[1]?.model).toBe("member");
    expect(written[1]?.data).toMatchObject({
      organizationId: "minted-1",
      userId: KEN.id,
      role: "owner",
    });
  });

  it("stamps createdAt on both rows, because the plugin's schema defaults neither", () => {
    // The plugin declares `createdAt` required and supplies no default, so an adapter left
    // to itself would write null and the column would refuse it.
    const { store, written } = fakeStore();

    return resolveActiveOrganization({ store, user: KEN }).then(() => {
      for (const row of written) {
        expect(row.data.createdAt).toBeInstanceOf(Date);
      }
    });
  });

  it("falls to the id-derived slug when the readable one is already somebody else's", async () => {
    // Two people called Ken. The first has `ken-suenobu`; the second must still get an
    // organization, and it must not be the first one's.
    const { store, written } = fakeStore({ takenSlugs: ["ken-suenobu"] });

    const resolved = await resolveActiveOrganization({ store, user: KEN });

    expect(resolved).toBe("minted-1");
    expect(written[0]?.data.slug).toBe("ken-suenobu-user-1");
  });

  it("answers null rather than failing the sign-in when no slug can be had", async () => {
    // The pathological case — every candidate refused. A sign-in that threw here would turn
    // a naming collision into "you cannot log in"; a null pointer is a working session and a
    // Step 2 the person can choose from.
    const { store, written } = fakeStore({
      takenSlugs: ["ken-suenobu", "ken-suenobu-user-1"],
    });

    expect(await resolveActiveOrganization({ store, user: KEN })).toBeNull();
    expect(written).toHaveLength(0);
  });
});

/** Build the endpoint context the hook reads, with only the two things it reaches for. */
function fakeContext(
  store: OrganizationStore,
  user: unknown,
): Parameters<NonNullable<typeof stampActiveOrganization>>[1] {
  return {
    context: { adapter: store, internalAdapter: { findUserById: () => Promise.resolve(user) } },
  } as unknown as Parameters<NonNullable<typeof stampActiveOrganization>>[1];
}

/** The session row the library is about to insert. */
const NEW_SESSION = { id: "session-1", userId: KEN.id } as unknown as Parameters<
  NonNullable<typeof stampActiveOrganization>
>[0];

describe("the session hook", () => {
  it("is a before hook, so the pointer is part of the insert rather than a later update", () => {
    // Every session has an active organization from the instant it exists — which matters,
    // because the request that created it is already on its way to a handler that may read
    // one.
    expect(activeOrganizationHooks()?.session?.create?.before).toBe(stampActiveOrganization);
  });

  it("hands back a fresh object each call, carrying the same shared hook", () => {
    // The hook is a module-level function rather than a closure so that two calls to
    // `authOptions` compare equal — `auth.options.spec.ts` asserts exactly that.
    const [first, second] = [activeOrganizationHooks(), activeOrganizationHooks()];

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("stamps the session with the organization it resolved", async () => {
    const { store } = fakeStore({ memberships: [{ organizationId: "org-existing" }] });

    const result = await stampActiveOrganization?.(NEW_SESSION, fakeContext(store, KEN));

    expect(result).toEqual({
      data: { ...NEW_SESSION, activeOrganizationId: "org-existing" },
    });
  });

  it("stamps null for somebody whose organization could not be established", async () => {
    // Explicitly `null` rather than omitted: the column is nullable, and a session that
    // starts out acting nowhere is the state mockup 01 Step 2 exists to resolve.
    const { store } = fakeStore({ takenSlugs: personalOrganizationSlugs(KEN) });

    const result = await stampActiveOrganization?.(NEW_SESSION, fakeContext(store, KEN));

    expect(result).toEqual({ data: { ...NEW_SESSION, activeOrganizationId: null } });
  });

  it("leaves the row alone when there is no request behind the session", async () => {
    // The library types the context nullable. There is no adapter to reach, and guessing
    // would be worse than a session that starts with a null pointer.
    expect(await stampActiveOrganization?.(NEW_SESSION, null)).toBeUndefined();
  });

  it("leaves the row alone when the person cannot be read", async () => {
    // Not this hook's failure to report: the library is about to fail on its own foreign
    // key, with a better message than anything here could produce.
    const { store, written } = fakeStore();

    expect(await stampActiveOrganization?.(NEW_SESSION, fakeContext(store, null))).toBeUndefined();
    expect(written).toHaveLength(0);
  });
});
