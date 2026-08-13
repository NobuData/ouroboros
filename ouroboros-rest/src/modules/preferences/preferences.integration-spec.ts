import { ApiHarness } from "../../testing/harness.fixture";
import { bodyOf } from "../../testing/integration.fixture";
import type { ErrorEnvelope } from "../errors/error.envelope";
import type { PreferencesResource } from "./resources";

/**
 * `/api/v1/me/preferences`, over a socket and against a migrated database
 * ([#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * The unit specs hold each layer to its own rules; what only this suite can certify is the
 * agreement between them and the schema: that V007's CHECK and the DTO refuse the same
 * things, that the upsert really is one row per person under the real primary key, and —
 * the acceptance criterion with a user's name on it — that **two people in one database
 * each get their own scale**. Per-user isolation through a mock proves the mock.
 *
 * ```bash
 * yarn test:integration
 * ```
 */

/** The surface under test. */
const PREFERENCES = "/api/v1/me/preferences";

describe("the preferences surface", () => {
  let api: ApiHarness;

  beforeAll(async () => {
    api = await ApiHarness.start();
  });

  afterAll(() => api.close());
  afterEach(() => api.truncate());

  it("refuses a stranger, on both verbs", async () => {
    // The global session guard, doing its one job here: preferences belong to somebody.
    await api.anonymous("get", PREFERENCES).expect(401);
    await api.anonymous("patch", PREFERENCES).send({ fontScale: "125" }).expect(401);
  });

  it("answers the defaults for a person who has never chosen", async () => {
    const person = await api.signUp();

    const response = await api.as(person)("get", PREFERENCES).expect(200);

    expect(bodyOf<PreferencesResource>(response)).toEqual({ fontScale: "100" });
  });

  it("round-trips a choice, and survives a re-read", async () => {
    const person = await api.signUp();

    const patched = await api
      .as(person)("patch", PREFERENCES)
      .send({ fontScale: "150" })
      .expect(200);
    expect(bodyOf<PreferencesResource>(patched)).toEqual({ fontScale: "150" });

    const read = await api.as(person)("get", PREFERENCES).expect(200);
    expect(bodyOf<PreferencesResource>(read)).toEqual({ fontScale: "150" });
  });

  it("upserts: a second choice replaces the first rather than colliding with it", async () => {
    const person = await api.signUp();

    await api.as(person)("patch", PREFERENCES).send({ fontScale: "112.5" }).expect(200);
    const second = await api
      .as(person)("patch", PREFERENCES)
      .send({ fontScale: "87.5" })
      .expect(200);

    expect(bodyOf<PreferencesResource>(second)).toEqual({ fontScale: "87.5" });

    // And it really is one row, under the real primary key — the property the unit spec
    // can only assert about the statement's text.
    const { rows } = await api.sql.query<{ total: number }>(
      "select count(*)::int as total from ouroboros.user_preferences where user_id = $1",
      [person.id],
    );
    expect(rows[0].total).toBe(1);
  });

  it("keeps two people's scales apart — the criterion with a user's name on it", async () => {
    // "The preference round-trips per user: two users at two different scales in one
    // browser each get their own." One database stands in for the one browser: the rows
    // are keyed by person, so the isolation is the schema's, not a cookie's.
    const reader = await api.signUp();
    const squinter = await api.signUp();

    await api.as(reader)("patch", PREFERENCES).send({ fontScale: "87.5" }).expect(200);
    await api.as(squinter)("patch", PREFERENCES).send({ fontScale: "150" }).expect(200);

    const readerBack = await api.as(reader)("get", PREFERENCES).expect(200);
    const squinterBack = await api.as(squinter)("get", PREFERENCES).expect(200);

    expect(bodyOf<PreferencesResource>(readerBack)).toEqual({ fontScale: "87.5" });
    expect(bodyOf<PreferencesResource>(squinterBack)).toEqual({ fontScale: "150" });
  });

  it("refuses a step § 4 does not name, naming the field", async () => {
    const person = await api.signUp();

    const response = await api
      .as(person)("patch", PREFERENCES)
      .send({ fontScale: "90" })
      .expect(422);

    const envelope = bodyOf<ErrorEnvelope>(response);
    expect(envelope.code).toBe("validation_failed");
    // The field is named in `details`, keyed by its path — the envelope's contract for a
    // form that wants to render the sentence beside the input that produced it.
    expect(Object.keys(envelope.details)).toContain("fontScale");

    // And nothing was written on the way to the refusal.
    const read = await api.as(person)("get", PREFERENCES).expect(200);
    expect(bodyOf<PreferencesResource>(read)).toEqual({ fontScale: "100" });
  });

  it("treats an empty patch as a read", async () => {
    const person = await api.signUp();

    await api.as(person)("patch", PREFERENCES).send({ fontScale: "125" }).expect(200);
    const emptied = await api.as(person)("patch", PREFERENCES).send({}).expect(200);

    expect(bodyOf<PreferencesResource>(emptied)).toEqual({ fontScale: "125" });
  });

  it("needs no workspace: a person who belongs to nothing still has preferences", async () => {
    // The @TenantOptional() argument, observed: a fresh sign-up may act in no organization,
    // and their text size must not depend on having somewhere to be.
    const person = await api.signUp();

    const response = await api
      .as(person)("patch", PREFERENCES)
      .send({ fontScale: "125" })
      .expect(200);

    expect(bodyOf<PreferencesResource>(response)).toEqual({ fontScale: "125" });
  });
});
