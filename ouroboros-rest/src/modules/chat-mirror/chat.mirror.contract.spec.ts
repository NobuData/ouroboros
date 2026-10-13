/**
 * The OpenAPI document and what the channel mirror sends (#542). Real pages composed by the real
 * service — every archetype of the stream — are held to `ChatMirror`, which is
 * `additionalProperties: false` throughout, so a field the page reads cannot go undocumented.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { document } from "../../openapi/specification";
import { CHANNEL, ITEM, ORGANIZATION, QUESTION_REFS } from "../chat/chat.fixture";
import {
  MAYA_ID,
  MAYA_RESOLUTION,
  READ_AT,
  ROWS,
  at,
  commandRow,
  messageRow,
  mockupStream,
  type FakeMirrorStore,
} from "./chat.mirror.fixture";
import { MIRROR_PAGE_DEFAULT, MIRROR_PAGE_MAX } from "./chat.mirror.service";

/**
 * A validator for one documented schema.
 *
 * @param name - The schema's name under `components/schemas`.
 * @returns A function answering Ajv's complaint, or undefined when the value validates.
 */
function validatorFor(name: string): (value: unknown) => string | undefined {
  const id = "https://ouroboros.invalid/openapi.json";
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: id, components: document().components });

  const validate = ajv.compile({ $ref: `${id}#/components/schemas/${name}` });
  return (value) => (validate(value) ? undefined : ajv.errorsText(validate.errors));
}

/** A value as the client receives it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The stream once the question is answered, with a digest and the refusals a command can get. */
function everything(): FakeMirrorStore {
  const store = mockupStream();
  const question = store.messages.get(CHANNEL)?.find((row) => row.id === ROWS.question);

  Object.assign(question as object, {
    state: "resolved",
    outcome: "allow_once",
    resolved_by: MAYA_ID,
    resolved_at: at("14:11"),
    escalated_at: at("14:10"),
  });
  store.resolutions.set(ITEM, MAYA_RESOLUTION);

  return store
    .say([
      messageRow(ROWS.line, at("14:11"), {
        kind: "system_line",
        card_kind: "protected_path_allow_once",
        decision_item_id: ITEM,
        refs: QUESTION_REFS,
        facts: { action: "allow_once", answered_by: "Maya Chen" },
      }),
      messageRow("a5420000-0000-4000-8000-000000000108", at("09:00"), {
        card_kind: "digest",
        facts: {
          window_from: "2026-10-05",
          window_to: "2026-10-11",
          merged_prs: 12,
          interventions: 3,
        },
      }),
      // A second question, still open.
      messageRow("a5420000-0000-4000-8000-000000000109", at("14:50"), {
        kind: "decision_card",
        card_kind: "protected_path_allow_once",
        decision_item_id: ITEM,
        refs: QUESTION_REFS,
        state: "open",
      }),
    ])
    .type([
      commandRow("a5420000-0000-4000-8000-000000000204", at("14:46"), {
        outcome: "unlinked",
        author_name: null,
        reply: { text: "You're not linked." },
      }),
      commandRow("a5420000-0000-4000-8000-000000000205", at("14:47"), {
        outcome: "async_pending",
        completed_at: null,
      }),
      commandRow("a5420000-0000-4000-8000-000000000206", at("14:48"), { reply: null }),
    ]);
}

describe("the channel mirror on the wire", () => {
  const mirror = validatorFor("ChatMirror");

  it("is the documented ChatMirror for a stream of every kind of entry", async () => {
    const page = await everything().service().read(ORGANIZATION, CHANNEL, {}, READ_AT);

    expect(page.entries.map((entry) => entry.type)).toEqual(
      expect.arrayContaining(["card", "line", "command"]),
    );
    expect(page.entries).toHaveLength(13);
    expect(mirror(wire(page))).toBeUndefined();
  });

  it("is the documented ChatMirror for an empty channel, and for a page with a cursor", async () => {
    const store = everything();

    store.messages.clear();
    store.commands.clear();

    expect(
      mirror(wire(await store.service().read(ORGANIZATION, CHANNEL, {}, READ_AT))),
    ).toBeUndefined();

    const paged = await everything().service().read(ORGANIZATION, CHANNEL, { limit: 3 }, READ_AT);

    expect(typeof paged.olderCursor).toBe("string");
    expect(mirror(wire(paged))).toBeUndefined();
  });

  it("refuses an entry with a field the document does not name, and an absolute card link", async () => {
    const page = wire(await mockupStream().service().read(ORGANIZATION, CHANNEL, {}, READ_AT)) as {
      entries: Record<string, unknown>[];
    };
    const [card] = page.entries;

    expect(mirror({ ...page, entries: [{ ...card, blocks: [] }] })).toBeDefined();
    expect(
      mirror({
        ...page,
        entries: [
          {
            ...card,
            actions: [{ id: "a", label: "A", href: "https://x.test/", style: "default" }],
          },
        ],
      }),
    ).toBeDefined();
  });

  it("documents the route's query as the route enforces it", () => {
    const parameters = (
      document().paths as Record<
        string,
        { get: { parameters: { name?: string; schema?: Record<string, unknown> }[] } }
      >
    )["/api/v1/chat/channels/{id}/mirror"].get.parameters;
    const limit = parameters.find((parameter) => parameter.name === "limit")?.schema;

    expect(limit).toMatchObject({
      minimum: 1,
      maximum: MIRROR_PAGE_MAX,
      default: MIRROR_PAGE_DEFAULT,
    });
    expect(parameters.map((parameter) => parameter.name).filter(Boolean)).toEqual([
      "id",
      "before",
      "limit",
    ]);
  });
});
