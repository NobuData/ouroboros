import { join } from "node:path";

import { GoldenFile } from "../../testing/golden.fixture";
import { ARCHETYPES, UI_URL } from "../chat/chat.fixture";
import type { ChatCard } from "../chat/chat.card";
import { digestCard } from "../chat/chat.cards.events";
import { loopFinishedCard } from "../chat/chat.cards.events";
import { LOOP_1846 } from "../chat/chat.fixture";
import { DIGEST_STATES, weekDigest } from "../insights/digest/digest.fixture";
import {
  ANSWER_ACTION_PREFIX,
  LINK_ACTION_PREFIX,
  SEVERITY_COLORS,
  cardBlocks,
  escapeMrkdwn,
  renderBlockKit,
} from "./slack.blockkit";

/**
 * The Block Kit backend (#536): a golden payload per archetype, and the rules that keep a fact
 * from becoming a mention, a broadcast or an oversized block.
 */

const GOLDEN_PATH = join(__dirname, "slack.blockkit.golden.json");
const REGENERATE = "OURO_UPDATE_GOLDENS=1 yarn jest src/modules/slack/slack.blockkit";

/** Every archetype the renderer must produce, by name. */
const CASES = {
  ...ARCHETYPES,
  loop_finished_unpriced: loopFinishedCard(
    { ...LOOP_1846, costCents: null, unpricedEvents: 12 },
    UI_URL,
  ),
  digest: digestCard(weekDigest(DIGEST_STATES.priced()), UI_URL),
  digest_unpriced: digestCard(weekDigest(DIGEST_STATES.unpriced()), UI_URL),
  digest_empty: digestCard(weekDigest(DIGEST_STATES.empty()), UI_URL),
} as const;

/** Every string a payload would show, wherever it sits. */
function shown(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(shown);
  }

  return typeof value === "object" && value !== null ? Object.values(value).flatMap(shown) : [];
}

describe("the Block Kit goldens", () => {
  const golden = new GoldenFile(
    GOLDEN_PATH,
    "The chat.postMessage payload of every card archetype (mockup 19) and system line, as the " +
      `Slack backend renders it from the card model. Regenerate with: ${REGENERATE}`,
    REGENERATE,
  );

  afterAll(() => {
    golden.save();
  });

  it.each(Object.entries(CASES))("renders the %s archetype as its golden", (name, model) => {
    golden.hold(name, renderBlockKit(model));
  });

  it("records exactly these archetypes", () => {
    if (!golden.updating) {
      expect(golden.names()).toEqual(Object.keys(CASES));
    }
  });
});

describe("a card in Block Kit", () => {
  it("is one attachment, coloured by severity, with the headline bold and the stats mono", () => {
    const { text, payload } = renderBlockKit(ARCHETYPES.loop_finished);

    expect(text).toBe("✓ Loop #1846 finished — PR #512 merged");
    expect(payload).toEqual({
      blocks: [],
      attachments: [
        {
          color: SEVERITY_COLORS.ok,
          fallback: text,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "*✓ Loop #1846 finished — PR #512 merged*" },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: "#474 Debounce e-stop interrupt handler" },
            },
            {
              type: "context",
              elements: [
                { type: "mrkdwn", text: "`14/14 checks · 11m cycle · $0.94 · claude-fable-5`" },
              ],
            },
            {
              type: "actions",
              elements: [
                expect.objectContaining({
                  type: "button",
                  action_id: `${LINK_ACTION_PREFIX}view_pr`,
                  url: `${UI_URL}/prs/a1370000-0000-4000-8000-000000000512`,
                }),
                expect.objectContaining({
                  type: "button",
                  action_id: `${LINK_ACTION_PREFIX}run_console`,
                }),
              ],
            },
          ],
        },
      ],
    });
  });

  it("gives every severity its own border", () => {
    expect(new Set(Object.values(SEVERITY_COLORS)).size).toBe(5);
    expect(
      (renderBlockKit(ARCHETYPES.question).payload as { attachments: { color: string }[] })
        .attachments[0].color,
    ).toBe(SEVERITY_COLORS.warn);
  });

  it("puts the signed value on an answer button, and a URL — never a value — on a link", () => {
    const blocks = cardBlocks(ARCHETYPES.question);
    const actions = blocks.find((block) => block.type === "actions") as {
      elements: Record<string, unknown>[];
    };

    expect(actions.elements).toEqual([
      {
        type: "button",
        action_id: `${ANSWER_ACTION_PREFIX}allow_once`,
        text: { type: "plain_text", text: "Allow once", emoji: true },
        value: "signed:allow_once",
        style: "primary",
      },
      expect.objectContaining({
        action_id: `${LINK_ACTION_PREFIX}view_diff`,
        url: `${UI_URL}/runs/a1360000-0000-4000-8000-000000001851#run-changes`,
      }),
      {
        type: "button",
        action_id: `${ANSWER_ACTION_PREFIX}deny`,
        text: { type: "plain_text", text: "Deny", emoji: true },
        value: "signed:deny",
      },
      expect.objectContaining({ action_id: `${LINK_ACTION_PREFIX}edit_protected_paths` }),
    ]);
    expect(actions.elements.filter((element) => "url" in element && "value" in element)).toEqual(
      [],
    );
  });

  it("offers no live button on the resolved card — there is no actions block at all", () => {
    const blocks = cardBlocks(ARCHETYPES.question_resolved);

    expect(blocks.map((block) => block.type)).toEqual(["section", "section", "context"]);
    expect(JSON.stringify(blocks)).not.toContain("button");
    expect(shown(blocks)).toContain("Maya Chen answered: allowed once · in Slack");
  });

  it("draws only the blocks a card has content for", () => {
    expect(cardBlocks(ARCHETYPES.build_green).map((block) => block.type)).toEqual([
      "section",
      "actions",
    ]);
  });

  it("never renders a price on an unpriced run's card", () => {
    expect(shown(renderBlockKit(CASES.loop_finished_unpriced)).join("\n")).not.toMatch(/\$/);
    expect(shown(renderBlockKit(CASES.digest_unpriced)).join("\n")).not.toMatch(/\$\d/);
  });

  it("renders a system line as one small context block, outside any attachment", () => {
    expect(renderBlockKit(ARCHETYPES.system_line)).toEqual({
      text: "✓ Maya Chen answered: allow once — loop #1851",
      payload: {
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "✓ Maya Chen answered: allow once — loop #1851" }],
          },
        ],
        attachments: [],
      },
    });
  });
});

describe("what a fact cannot do", () => {
  const hostile: ChatCard = {
    kind: "card",
    severity: "info",
    mark: "✓",
    headline: "<!channel> merged <https://evil.example|PR #1> & more",
    lines: ["by <@U024AB>", "a > b"],
    stats: "model `x` <!here>",
    actions: [],
    footnote: "<!everyone>",
  };

  it("escapes Slack's three control characters", () => {
    expect(escapeMrkdwn("<!channel> & <@U1> > x")).toBe(
      "&lt;!channel&gt; &amp; &lt;@U1&gt; &gt; x",
    );
  });

  it("cannot ping a channel, mention a person or disguise a link from inside a card", () => {
    const rendered = renderBlockKit(hostile);
    const text = [rendered.text, ...shown(rendered.payload)].join("\n");

    expect(text).not.toMatch(/<[!@#]|<https?:/);
    expect(text).toContain("&lt;!channel&gt;");
    // The notification text and the attachment's fallback are parsed by Slack as well.
    expect(rendered.text).toBe(
      "✓ &lt;!channel&gt; merged &lt;https://evil.example|PR #1&gt; &amp; more",
    );
  });

  it("keeps the mono line mono when a figure contains a backtick", () => {
    const stats = cardBlocks(hostile).find((block) => block.type === "context") as {
      elements: { text: string }[];
    };

    expect(stats.elements[0].text).toBe("`model 'x' &lt;!here&gt;`");
  });

  it("clips what is longer than Slack takes, rather than letting Slack refuse the card", () => {
    const long: ChatCard = {
      ...hostile,
      headline: "h".repeat(5000),
      lines: ["l".repeat(5000)],
      actions: Array.from({ length: 40 }, (_unused, index) => ({
        type: "link" as const,
        id: `l${String(index)}`,
        label: "b".repeat(200),
        url: "https://app.example.test/x",
      })),
    };
    const { text, payload } = renderBlockKit(long);
    const blocks = (payload as { attachments: { blocks: Record<string, unknown>[] }[] })
      .attachments[0].blocks;
    const sections = blocks.filter((block) => block.type === "section") as {
      text: { text: string };
    }[];
    const actions = blocks.find((block) => block.type === "actions") as {
      elements: { text: { text: string } }[];
    };

    expect(text.length).toBeLessThanOrEqual(300);
    expect(sections.every((section) => section.text.text.length <= 3000)).toBe(true);
    expect(actions.elements).toHaveLength(25);
    expect(actions.elements[0].text.text.length).toBeLessThanOrEqual(75);
  });
});
