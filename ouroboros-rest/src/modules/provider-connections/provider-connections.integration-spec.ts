import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import type request from "supertest";

import {
  ApiHarness,
  HARNESS_PASSWORD,
  type Person,
  type Workspace,
} from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import { sessionTokenIn } from "../auth/session.fixture";
import { SCHEMA_NAME } from "../db/schema";
import type { ErrorEnvelope } from "../errors/error.envelope";
import { OPENAI_COMPATIBLE_API_KEY_FIELD } from "../providers/adapters/openai-compatible.adapter";
import { BASE_URL_FIELD, CAPABILITY_NOTE_FIELD } from "../providers/provider.config";
import type { Page } from "../tenancy/pagination";
import { ADMINISTRATORS } from "../tenancy/roles.guard";
import { TENANT_HEADER } from "../tenancy/tenant.resolver";
import { SUFFIX_LENGTH } from "./masking";
import type { ProviderConnectionResource, RevealResource } from "./resources";
import { REVEAL_ATTEMPTS_PER_CONNECTION } from "./reveal.limiter";
import { STEP_UP_MAX_AGE_SECONDS } from "./step-up";

/**
 * The credential lifecycle end to end — the ticket's first acceptance criterion, *the full
 * lifecycle passes in the integration harness*.
 *
 * ---------------------------------------------------------------------------
 * **The provider is real, and it is a server this file starts.**
 *
 * Every operation here turns on a *live* validation, so a suite that stubbed the adapter
 * would be asserting about the stub at exactly the point the ticket is about. Instead a
 * one-route HTTP server stands in for the vendor: it serves `GET /v1/models`, answers `401`
 * to a wrong key and `200` to the right one, and the **real** `openai_compatible` adapter
 * reaches it over a real socket. That kind is chosen because it is the one whose address is
 * configurable — which is what lets a test point it at `127.0.0.1`, and it is also why
 * `provider.address.ts` deliberately permits loopback and RFC-1918.
 *
 * So what runs below is the whole pipeline: the session guard, the tenant guard, the roles
 * guard, the validation pipe, the adapter registry, the real vault over a real
 * `tenant_keys`, V015's own CHECKs, and Y.1's foreign key.
 *
 * ---------------------------------------------------------------------------
 * **What only this suite can assert.** The unit suites run the same rules over mocks, and
 * that is what makes these worth their seconds:
 *
 *   * **A refused key persists nothing** — asserted against `count(*)`, not against a mock.
 *   * **A failed rotation leaves the old credential live** — asserted by revealing it
 *     afterwards and getting the *old* value back, through the real vault.
 *   * **The delete guard is V015's foreign key**, not a check somebody remembered to write.
 *   * **Nothing in any list or read payload carries secret material**, grepped over the
 *     bytes that actually crossed a socket.
 *   * **A member is refused server-side**, through the guard chain rather than through
 *     metadata.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const PROVIDERS = "/api/v1/providers";

/** The credential the stub provider accepts. */
const GOOD_KEY = "sk-int-0000-known-good-credential-Xq4A";

/** A second one, for the rotation that succeeds. */
const NEXT_KEY = "sk-int-0000-the-rotated-credential-7Kd2";

/** One the stub provider refuses with a `401`. */
const BAD_KEY = "sk-int-0000-this-key-is-not-accepted";

describe("the credential lifecycle, against a migrated database and a live provider", () => {
  let api: ApiHarness;
  let provider: Server;
  let baseUrl: string;

  beforeAll(async () => {
    provider = createServer((request: IncomingMessage, response: ServerResponse) => {
      const authorization = request.headers.authorization;

      if (
        authorization !== undefined &&
        ![GOOD_KEY, NEXT_KEY].some((key) => authorization === `Bearer ${key}`)
      ) {
        // The `401` the whole "a bad key is never stored" half of this ticket rests on. A
        // request carrying no credential at all is accepted, which is what an unauthenticated
        // vLLM really does — and what makes the keyless cases below real rather than arranged.
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [] }));
    });

    await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port.toString()}/v1`;

    api = await ApiHarness.start();
  });

  afterAll(async () => {
    await api.close();
    await new Promise<void>((resolve, reject) => {
      provider.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(async () => {
    await api.truncate();
  });

  /** Somebody who signed up with a password, and a workspace they own. */
  async function owned(): Promise<{ owner: Person; space: Workspace }> {
    const owner = await api.signUp();

    return { owner, space: await api.workspace(owner) };
  }

  /** A request from somebody, acting in a workspace. */
  const acting =
    (person: Person, space: Workspace) =>
    (method: "get" | "post" | "patch" | "delete", path: string) =>
      api.as(person)(method, path).set(TENANT_HEADER, space.slug);

  /** The body an add sends. */
  const addBody = (secret: string | null = GOOD_KEY, overrides: Record<string, unknown> = {}) => ({
    kind: "openai_compatible",
    displayName: "OpenAI-compatible · local vLLM",
    monthlyCapCents: 60_000,
    config: {
      [BASE_URL_FIELD]: baseUrl,
      ...(secret === null ? {} : { [OPENAI_COMPATIBLE_API_KEY_FIELD]: secret }),
    },
    ...overrides,
  });

  /** Connect a provider and answer the resource. */
  async function connect(
    person: Person,
    space: Workspace,
    secret: string | null = GOOD_KEY,
  ): Promise<ProviderConnectionResource> {
    return bodyOf<ProviderConnectionResource>(
      await acting(person, space)("post", PROVIDERS).send(addBody(secret)).expect(201),
    );
  }

  /** How many connections this workspace has, read outside the application. */
  async function storedCount(organizationId: string): Promise<number> {
    const { rows } = await api.sql.query<{ count: string }>(
      `select count(*)::text as count from ${SCHEMA_NAME}.provider_connections
       where organization_id = $1`,
      [organizationId],
    );

    return Number(rows[0].count);
  }

  /** The sealed value on one connection, read outside the application. */
  async function storedEnvelope(connectionId: string): Promise<string | null> {
    const { rows } = await api.sql.query<{ credentials_encrypted: string | null }>(
      `select credentials_encrypted from ${SCHEMA_NAME}.provider_connections where id = $1`,
      [connectionId],
    );

    return rows[0].credentials_encrypted;
  }

  /**
   * Replace a connection's sealed credential with one this deployment cannot open.
   *
   * Written outside the application, because there is no operation that produces this: it is
   * what `ouroboros-db/migrations/R__dev_seed_providers.sql` stores for its three cloud cards,
   * and what a workspace whose key version has been rotated away and lost holds for real. The
   * shape satisfies V015's CHECK — `ouro.v1.<version>.<nonce>.<ciphertext>`, base64url — and
   * the body is the seed's own words rather than random bytes, so a failure names something a
   * reader can search for.
   *
   * @param connectionId - The connection to break.
   * @returns When the row holds it.
   */
  async function unsealable(connectionId: string): Promise<void> {
    await api.sql.query(
      `update ${SCHEMA_NAME}.provider_connections set credentials_encrypted = $2 where id = $1`,
      [
        connectionId,
        "ouro.v1.1.c2VlZC1ub25jZS0x." +
          "ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWFudGhyb3BpYw",
      ],
    );
  }

  /**
   * A second, **older** session for somebody, and a request builder that carries it.
   *
   * A person who has just signed up has *just re-authenticated*, so their session satisfies
   * the step-up on its own — which is correct behaviour and makes the challenge unreachable
   * from their browser. Every assertion below that is about the challenge therefore acts
   * through a session minted directly and then aged past the window, which is what somebody
   * coming back to a tab the next morning has.
   *
   * It is a *second* session rather than an update to the first, and that is not
   * incidental: `signUp` leaves BetterAuth's signed **cookie cache** in the browser's jar,
   * and while that snapshot is fresh the guard answers from it without reading the row — so
   * ageing the row underneath a cached session would change nothing for five minutes. A
   * cookie minted by the harness carries no snapshot, so every request through it resolves
   * the session from the database it was just aged in.
   *
   * @param person - Whose.
   * @param space - The workspace to act in.
   * @returns A request builder carrying the aged session and the tenant header.
   */
  async function staleActing(
    person: Person,
    space: Workspace,
  ): Promise<(method: "get" | "post" | "patch" | "delete", path: string) => request.Test> {
    const cookie = await api.session(person.id);

    await api.sql.query(
      `update ${SCHEMA_NAME}.session
          set "createdAt" = now() - make_interval(secs => $2)
        where "token" = $1`,
      [sessionTokenIn(cookie), STEP_UP_MAX_AGE_SECONDS * 4],
    );

    return (method, path) =>
      api.anonymous(method, path).set("Cookie", cookie).set(TENANT_HEADER, space.slug);
  }

  describe("connecting a provider", () => {
    it("validates against the live provider, seals the credential and stores the row", async () => {
      const { owner, space } = await owned();

      const connection = await connect(owner, space);

      expect(connection).toMatchObject({
        kind: "openai_compatible",
        displayName: "OpenAI-compatible · local vLLM",
        baseUrl,
        status: "active",
        enabled: true,
        monthlyCapCents: 60_000,
        mask: `••••${GOOD_KEY.slice(-SUFFIX_LENGTH)}`,
        addedBy: owner.id,
      });
      // Sealed, and V015's own CHECK is what makes that true of every writer — the column
      // cannot hold anything that is not one of the vault's envelopes.
      expect(await storedEnvelope(connection.id)).toMatch(/^ouro\.v1\.\d+\./);
    });

    it("fails without persisting anything when the provider refuses the key", async () => {
      const { owner, space } = await owned();

      const response = await acting(owner, space)("post", PROVIDERS)
        .send(addBody(BAD_KEY))
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("provider_validation_failed");
      expect(envelope.details).toMatchObject({ errorClass: "auth" });
      expect(await storedCount(space.id)).toBe(0);
    });

    it("fails without persisting anything when the address does not answer", async () => {
      const { owner, space } = await owned();

      await acting(owner, space)("post", PROVIDERS)
        .send(addBody(GOOD_KEY, { config: { [BASE_URL_FIELD]: "http://127.0.0.1:1/v1" } }))
        .expect(422);

      expect(await storedCount(space.id)).toBe(0);
    });

    it("refuses a submission the adapter's schema will not accept, naming the field", async () => {
      const { owner, space } = await owned();

      const response = await acting(owner, space)("post", PROVIDERS)
        .send(addBody(GOOD_KEY, { config: {} }))
        .expect(422);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("provider_config_invalid");
      const fields = (envelope.details as { fields: Record<string, string[]> }).fields;
      expect(Object.keys(fields)).toEqual([BASE_URL_FIELD]);
      expect(await storedCount(space.id)).toBe(0);
    });

    it("connects a provider that needs no credential at all", async () => {
      const { owner, space } = await owned();

      const connection = await connect(owner, space, null);

      expect(connection.mask).toBeNull();
      expect(await storedEnvelope(connection.id)).toBeNull();
    });

    it("stores the note the adapter's schema declares", async () => {
      const { owner, space } = await owned();

      const connection = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("post", PROVIDERS)
          .send(
            addBody(GOOD_KEY, {
              config: {
                [BASE_URL_FIELD]: baseUrl,
                [OPENAI_COMPATIBLE_API_KEY_FIELD]: GOOD_KEY,
                [CAPABILITY_NOTE_FIELD]: "self-hosted · A100 ×2",
              },
            }),
          )
          .expect(201),
      );

      expect(connection.capabilityNote).toBe("self-hosted · A100 ×2");
    });

    it("answers 501 for a kind this build has no adapter for", async () => {
      const { owner, space } = await owned();

      const response = await acting(owner, space)("post", PROVIDERS)
        .send({ kind: "custom", displayName: "Something", config: {} })
        .expect(501);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("provider_kind_unsupported");
    });
  });

  describe("reading", () => {
    it("lists a workspace's connections with the credential masked", async () => {
      const { owner, space } = await owned();
      await connect(owner, space);

      const page = bodyOf<Page<ProviderConnectionResource>>(
        await acting(owner, space)("get", PROVIDERS).expect(200),
      );

      expect(page.total).toBe(1);
      expect(page.items[0].mask).toBe(`••••${GOOD_KEY.slice(-SUFFIX_LENGTH)}`);
    });

    it("serves a connection whose credential this deployment cannot open, with no mask", async () => {
      // The failure the AE.7 e2e leg ([#233](https://github.com/NobuData/ouroboros/issues/233))
      // found by pointing a browser at a cold compose stack, where three of the seeded cards
      // hold exactly this: a value that satisfies V015's envelope CHECK and was never sealed by
      // anything, because no SQL file can produce an AES-256-GCM envelope under a workspace DEK.
      //
      // The listing opens every credential to compute its mask, so before the fix one such row
      // answered `500` and took the whole page — every other provider included — with it. A
      // mask is one field of one row, and this is the assertion that it is treated as one.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await unsealable(connection.id);

      const page = bodyOf<Page<ProviderConnectionResource>>(
        await acting(owner, space)("get", PROVIDERS).expect(200),
      );

      expect(page.total).toBe(1);
      // `null` rather than bare bullets: `MASK_ONLY` means *a credential too short to have a
      // readable tail*, and reusing it here would say something false about a value nobody
      // read. What the card draws from a null mask is its placeholder and a **Save**.
      expect(page.items[0].mask).toBeNull();
    });

    it("keeps the rest of the workspace readable when one credential will not open", async () => {
      // The half that makes the one above worth having. A page of five providers where one row
      // is unreadable must be a page of five providers, not a refusal — which is the difference
      // between a card with an empty key field and a screen that says nothing could be read.
      const { owner, space } = await owned();
      const broken = await connect(owner, space);
      const working = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("post", PROVIDERS)
          .send({ ...addBody(GOOD_KEY), displayName: "Still readable" })
          .expect(201),
      );

      await unsealable(broken.id);

      const page = bodyOf<Page<ProviderConnectionResource>>(
        await acting(owner, space)("get", PROVIDERS).expect(200),
      );

      expect(page.total).toBe(2);
      expect(page.items.find((item) => item.id === working.id)?.mask).toBe(
        `••••${GOOD_KEY.slice(-SUFFIX_LENGTH)}`,
      );
      expect(page.items.find((item) => item.id === broken.id)?.mask).toBeNull();

      // …and the single read of the broken row is a row too, for the same reason.
      const read = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("get", `${PROVIDERS}/${broken.id}`).expect(200),
      );

      expect(read.mask).toBeNull();
      expect(read.displayName).toBe(broken.displayName);
    });

    it("never puts secret material in a list or a read payload", async () => {
      // The ticket's contract test, over the bytes that actually crossed a socket. Windowed
      // rather than a whole-string search: the mistake that matters is a payload carrying
      // *most* of a credential, and a whole-string search would sail past all of them.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      const payloads = [
        (await acting(owner, space)("get", PROVIDERS).expect(200)).text,
        (await acting(owner, space)("get", `${PROVIDERS}/${connection.id}`).expect(200)).text,
      ];

      for (const payload of payloads) {
        expect(payload).not.toContain(GOOD_KEY);
        expect(payload).not.toContain("ouro.v1.");

        for (let start = 0; start + SUFFIX_LENGTH + 1 <= GOOD_KEY.length; start += 1) {
          expect(payload).not.toContain(GOOD_KEY.slice(start, start + SUFFIX_LENGTH + 1));
        }
      }
    });

    it("answers 404 for another workspace's connection", async () => {
      // Organization isolation, on the endpoint where a `403` would confirm that an id names
      // a real provider connection.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const stranger = await api.signUp();
      const elsewhere = await api.workspace(stranger);

      const response = await acting(stranger, elsewhere)(
        "get",
        `${PROVIDERS}/${connection.id}`,
      ).expect(404);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("provider_connection_not_found");
    });
  });

  describe("revealing", () => {
    it("challenges a session with no recent re-authentication", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const returning = await staleActing(owner, space);

      const response = await returning("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({})
        .expect(401);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("step_up_required");
      expect(envelope.details).toMatchObject({ methods: ["session", "password"] });
    });

    it("answers the credential to a session that has just signed in", async () => {
      // A fresh session *is* a re-authentication, and it is the only method a GitHub-only
      // account has. `signUp` has just completed one, so nothing is arranged here.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      const revealed = bodyOf<RevealResource>(
        await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
          .send({})
          .expect(200),
      );

      expect(revealed.value).toBe(GOOD_KEY);
      expect(revealed.connectionId).toBe(connection.id);
    });

    it("answers the credential to a stale session that confirms its password", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const returning = await staleActing(owner, space);

      const revealed = bodyOf<RevealResource>(
        await returning("post", `${PROVIDERS}/${connection.id}/reveal`)
          .send({ password: HARNESS_PASSWORD })
          .expect(200),
      );

      expect(revealed.value).toBe(GOOD_KEY);
    });

    it("challenges a wrong password exactly as it challenges an absent one", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const returning = await staleActing(owner, space);

      const response = await returning("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({ password: "not-the-right-password" })
        .expect(401);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("step_up_required");
    });

    it("forbids anything in between from storing the answer", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      const response = await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({})
        .expect(200);

      expect(response.headers["cache-control"]).toBe("no-store");
    });

    it("rate-limits attempts, counting the ones that failed the step-up", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const returning = await staleActing(owner, space);

      for (let attempt = 0; attempt < REVEAL_ATTEMPTS_PER_CONNECTION; attempt += 1) {
        await returning("post", `${PROVIDERS}/${connection.id}/reveal`)
          .send({ password: "wrong" })
          .expect(401);
      }

      // Even the *right* password is refused now, which is the point: the limiter runs in
      // front of the step-up, so a wrong password costs an attempt.
      const response = await returning("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({ password: HARNESS_PASSWORD })
        .expect(429);

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("provider_reveal_rate_limited");
      expect(envelope.details).toMatchObject({ scope: "connection" });
    });

    it("answers 409 for a connection that stores no credential", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space, null);

      const response = await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({})
        .expect(409);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("provider_credential_absent");
    });
  });

  describe("rotating", () => {
    it("validates the new credential and swaps it in", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const before = await storedEnvelope(connection.id);

      const rotated = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
          .send({ secret: NEXT_KEY })
          .expect(200),
      );

      expect(rotated.mask).toBe(`••••${NEXT_KEY.slice(-SUFFIX_LENGTH)}`);
      expect(await storedEnvelope(connection.id)).not.toBe(before);

      const revealed = bodyOf<RevealResource>(
        await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
          .send({})
          .expect(200),
      );
      expect(revealed.value).toBe(NEXT_KEY);
    });

    it("leaves the old credential live and working when the new one is refused", async () => {
      // The ticket's criterion, asserted the only way that means anything: reveal afterwards
      // and get the *old* value back, through the real vault and the real column.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const before = await storedEnvelope(connection.id);

      const response = await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
        .send({ secret: BAD_KEY })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("provider_validation_failed");
      expect(await storedEnvelope(connection.id)).toBe(before);

      const revealed = bodyOf<RevealResource>(
        await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
          .send({})
          .expect(200),
      );
      expect(revealed.value).toBe(GOOD_KEY);
    });

    it("adds a credential to a connection whose optional one was absent", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space, null);

      const rotated = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
          .send({ secret: GOOD_KEY })
          .expect(200),
      );

      expect(rotated.mask).toBe(`••••${GOOD_KEY.slice(-SUFFIX_LENGTH)}`);
    });
  });

  describe("editing", () => {
    it("turns a connection off without touching its aliases or its credential", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const before = await storedEnvelope(connection.id);

      const updated = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
          .send({ enabled: false, monthlyCapCents: 75_000, capabilityNote: "paused for review" })
          .expect(200),
      );

      expect(updated).toMatchObject({
        enabled: false,
        monthlyCapCents: 75_000,
        capabilityNote: "paused for review",
        mask: `••••${GOOD_KEY.slice(-SUFFIX_LENGTH)}`,
      });
      expect(await storedEnvelope(connection.id)).toBe(before);
    });

    it("clears a cap and a note with an explicit null", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      const updated = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
          .send({ monthlyCapCents: null, capabilityNote: null })
          .expect(200),
      );

      expect(updated.monthlyCapCents).toBeNull();
      expect(updated.capabilityNote).toBeNull();
    });

    it("validates an address change against the live provider before writing it", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
        .send({ config: { [BASE_URL_FIELD]: "http://127.0.0.1:1/v1" } })
        .expect(422);

      const unchanged = bodyOf<ProviderConnectionResource>(
        await acting(owner, space)("get", `${PROVIDERS}/${connection.id}`).expect(200),
      );
      expect(unchanged.baseUrl).toBe(baseUrl);
    });

    it("refuses a capability note sent inside config", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      const response = await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
        .send({ config: { [CAPABILITY_NOTE_FIELD]: "elsewhere" } })
        .expect(422);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("provider_config_invalid");
    });

    it("refuses a credential smuggled into an edit", async () => {
      // `whitelist` plus `forbidNonWhitelisted`: a field the DTO does not declare is refused
      // outright rather than dropped, which is the mass-assignment failure closed by
      // construction.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("patch", `${PROVIDERS}/${connection.id}`)
        .send({ secret: NEXT_KEY })
        .expect(422);
    });
  });

  describe("disconnecting", () => {
    it("removes a connection nothing depends on", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("delete", `${PROVIDERS}/${connection.id}`).expect(204);

      expect(await storedCount(space.id)).toBe(0);
    });

    it("refuses while aliases resolve on it, and names them", async () => {
      // V015's `model_aliases_provider_fk` is what makes the delete impossible; the message
      // is what turns that into an instruction.
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      for (const alias of ["coder-max", "local-docs"]) {
        await api.sql.query(
          `insert into ${SCHEMA_NAME}.model_aliases
             ("id", organization_id, alias, provider_connection_id, model_id)
           values (gen_random_uuid(), $1, $2, $3, 'some/model')`,
          [space.id, alias, connection.id],
        );
      }

      const response = await acting(owner, space)("delete", `${PROVIDERS}/${connection.id}`).expect(
        409,
      );

      const envelope = bodyOf<ErrorEnvelope>(response);
      expect(envelope.code).toBe("provider_connection_in_use");
      expect(envelope.details).toMatchObject({ aliases: ["coder-max", "local-docs"] });
      expect(await storedCount(space.id)).toBe(1);
    });

    it("takes the sealed credential with it", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);

      await acting(owner, space)("delete", `${PROVIDERS}/${connection.id}`).expect(204);

      const { rows } = await api.sql.query<{ count: string }>(
        `select count(*)::text as count from ${SCHEMA_NAME}.provider_connections where id = $1`,
        [connection.id],
      );
      expect(rows[0].count).toBe("0");
    });
  });

  describe("who may ask", () => {
    it("refuses a stranger everywhere", async () => {
      await api.anonymous("get", PROVIDERS).expect(401);
      await api.anonymous("post", PROVIDERS).expect(401);
    });

    it("asks a session acting in no workspace to choose one", async () => {
      const nomad = await api.signIn();

      const response = await api.as(nomad)("get", PROVIDERS).expect(400);

      expect(bodyOf<ErrorEnvelope>(response).code).toBe("organization_required");
    });

    it("lets a viewer read a masked list", async () => {
      const { owner, space } = await owned();
      await connect(owner, space);
      const viewer = await api.signUp();
      await api.join(space.id, viewer, "viewer");

      const page = bodyOf<Page<ProviderConnectionResource>>(
        await acting(viewer, space)("get", PROVIDERS).expect(200),
      );

      expect(page.items[0].mask).toBe(`••••${GOOD_KEY.slice(-SUFFIX_LENGTH)}`);
    });

    it("refuses every write to a member, server-side, and writes nothing", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const member = await api.signUp();
      await api.join(space.id, member, "member");

      const refusals = await Promise.all([
        acting(member, space)("post", PROVIDERS).send(addBody()).expect(403),
        acting(member, space)("patch", `${PROVIDERS}/${connection.id}`)
          .send({ enabled: false })
          .expect(403),
        acting(member, space)("delete", `${PROVIDERS}/${connection.id}`).expect(403),
        acting(member, space)("post", `${PROVIDERS}/${connection.id}/rotate`)
          .send({ secret: NEXT_KEY })
          .expect(403),
      ]);

      for (const refusal of refusals) {
        const envelope = bodyOf<ErrorEnvelope>(refusal);
        expect(envelope.code).toBe("forbidden");
        expect(envelope.details).toMatchObject({ required: [...ADMINISTRATORS] });
      }

      expect(await storedCount(space.id)).toBe(1);
      expect(
        bodyOf<ProviderConnectionResource>(
          await acting(owner, space)("get", `${PROVIDERS}/${connection.id}`).expect(200),
        ).enabled,
      ).toBe(true);
    });

    it("refuses a member's reveal, which is a write for this purpose", async () => {
      const { owner, space } = await owned();
      const connection = await connect(owner, space);
      const member = await api.signUp();
      await api.join(space.id, member, "member");

      await acting(member, space)("post", `${PROVIDERS}/${connection.id}/reveal`)
        .send({})
        .expect(403);
    });
  });
});
