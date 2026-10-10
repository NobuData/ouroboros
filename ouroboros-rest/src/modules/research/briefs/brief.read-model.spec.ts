import { repositoryResolver } from "./brief.citations";
import { briefParagraphs, citesOf, segmentsOf, type BriefSource } from "./brief.read-model";
import { brief, claims, ledger, sourceId } from "./rs127.fixture";

/** A stored brief, made renderable (#621). */

const resolve = repositoryResolver(["acme-robotics/helios-firmware"]);
const sources = new Map<string, BriefSource>(ledger().map((row) => [row.id, row]));
const GIT = sources.get(sourceId(44)) as BriefSource;

describe("the brief read model", () => {
  const [paragraph] = briefParagraphs(brief().body, claims(), sources, resolve);

  it("renders mockup 22's excerpt: each claim span followed by its cites", () => {
    expect(
      paragraph.spans
        .map((span) => span.text + span.cites.map((cite) => cite.label).join(""))
        .join(""),
    ).toBe(
      "The docking gap is not sensors: our IMU and rangefinder match Skylink's published spec.[07]" +
        " It is control — Skylink runs a wind-feedforward MPC in the final 2 m[12][31]" +
        " while ours is PID with fixed gains (dock_ctrl.c:214, unchanged in 14 months).[git]" +
        " Their abort logic retries from a re-planned approach vector; ours returns to loiter and" +
        ' waits for the operator — the behavior customers describe as "giving up."[19]' +
        " Estimated closure: one epic, 5 tickets, ~3 weeks of loop time on the HIL rig.",
    );
  });

  it("orders a span's cites by the ledger, however the links were stored", () => {
    expect(paragraph.spans[1].cites).toEqual([
      { label: "[12]", citeNo: 12, citeKey: null, sourceId: sourceId(12) },
      { label: "[31]", citeNo: 31, citeKey: null, sourceId: sourceId(31) },
    ]);
  });

  it("types each claim span, and leaves connective prose with no claim and no cite", () => {
    expect(paragraph.kind).toBe("findings");
    expect(paragraph.spans[0].claim).toEqual({
      ref: "sensors-match",
      type: "finding",
      demoted: false,
    });
    expect(paragraph.spans[4].claim).toBeNull();
    expect(paragraph.spans[4].cites).toEqual([]);
  });

  it("draws the code reference mono, linked to the file at the cited commit", () => {
    expect(paragraph.spans[2].segments).toEqual([
      { kind: "text", text: " while ours is PID with fixed gains (", href: null },
      {
        kind: "code",
        text: "dock_ctrl.c:214",
        href: "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L214",
      },
      { kind: "text", text: ", unchanged in 14 months).", href: null },
    ]);
    // A span that cites no code is one run of prose.
    expect(paragraph.spans[0].segments).toEqual([
      { kind: "text", text: paragraph.spans[0].text, href: null },
    ]);
  });

  it("renders an open question as one — typed, uncited, and in a paragraph of its own kind", () => {
    const paragraphs = briefParagraphs(
      {
        paragraphs: [
          { spans: [{ text: "Does AeroMesh use a beacon?", claim: "q1" }] },
          { spans: [{ text: "In short:" }] },
          {
            spans: [
              { text: "Skylink ships it.", claim: "f1" },
              { text: " Does Novum?", claim: "q2" },
            ],
          },
        ],
      },
      [
        { ref: "q1", type: "open_question", text: "A beacon?", demoted: true, sources: [] },
        {
          ref: "f1",
          type: "finding",
          text: "Skylink ships.",
          demoted: false,
          sources: [sourceId(1)],
        },
        { ref: "q2", type: "open_question", text: "Novum?", demoted: false, sources: [] },
      ],
      sources,
      resolve,
    );

    expect(paragraphs.map((each) => each.kind)).toEqual(["open_questions", "text", "findings"]);
    expect(paragraphs[0].spans[0].claim).toEqual({
      ref: "q1",
      type: "open_question",
      demoted: true,
    });
    expect(paragraphs[0].spans[0].cites).toEqual([]);
    expect(paragraphs[2].spans[1].claim?.type).toBe("open_question");
  });

  it("treats a span naming a claim that was never written as prose", () => {
    const [orphan] = briefParagraphs(
      { paragraphs: [{ spans: [{ text: "Unbacked.", claim: "ghost" }] }] },
      [],
      sources,
      resolve,
    );

    expect(orphan.spans[0].claim).toBeNull();
    expect(orphan.kind).toBe("text");
  });
});

describe("a span's cites", () => {
  it("lists each record once, and skips an id the ledger does not hold", () => {
    expect(
      citesOf([sourceId(12), sourceId(7), sourceId(12), sourceId(99)], sources).map(
        (cite) => cite.label,
      ),
    ).toEqual(["[07]", "[12]"]);
  });
});

describe("code references", () => {
  it("recognises a full path, a line range and a bare file name", () => {
    const segments = segmentsOf(
      "See src/dock/dock_ctrl.c:200-230 and dock_ctrl.c.",
      [GIT],
      resolve,
    );

    expect(segments.filter((segment) => segment.kind === "code")).toEqual([
      {
        kind: "code",
        text: "src/dock/dock_ctrl.c:200-230",
        href: "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c#L200-L230",
      },
      {
        kind: "code",
        text: "dock_ctrl.c",
        href: "https://github.com/acme-robotics/helios-firmware/blob/8c1b2e4/src/dock/dock_ctrl.c",
      },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "See src/dock/dock_ctrl.c:200-230 and dock_ctrl.c.",
    );
  });

  it("does not match inside a longer name, or a file the span does not cite", () => {
    expect(segmentsOf("old_dock_ctrl.c and dock_ctrl.cpp and pid.c:9", [GIT], resolve)).toEqual([
      { kind: "text", text: "old_dock_ctrl.c and dock_ctrl.cpp and pid.c:9", href: null },
    ]);
  });

  it("draws the reference mono without a link when the repository does not resolve", () => {
    expect(segmentsOf("dock_ctrl.c:214", [GIT], repositoryResolver([]))).toEqual([
      { kind: "code", text: "dock_ctrl.c:214", href: null },
    ]);
  });

  it("ignores a code source with no path, and one that is not a git locator", () => {
    const bare = { ...GIT, locator: "git://helios-firmware@8c1b2e4" };
    const bisect = { ...GIT, locator: "bisect://5eed/abc" };

    expect(segmentsOf("dock_ctrl.c:214", [bare, bisect], resolve)).toEqual([
      { kind: "text", text: "dock_ctrl.c:214", href: null },
    ]);
  });
});
