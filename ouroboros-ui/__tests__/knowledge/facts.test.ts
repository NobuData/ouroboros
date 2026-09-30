import { describe, expect, it } from "vitest";

import { KNOWLEDGE_PATH, prPath, runPath } from "@/app/paths";
import {
  ALL_REVIEWED,
  ANCHOR_DUPLICATE,
  ANCHOR_VALUE_REQUIRED,
  FACT_TEXT_LONG,
  FACT_TEXT_MAX,
  FACT_TEXT_REQUIRED,
  RELEARNED_NOTE,
  STALE_NO_REASON,
  TICKET_UNRESOLVED,
  VIEWER_REASON,
  actionName,
  addAnchor,
  announcement,
  awaitingChip,
  codeSpans,
  confirmedBy,
  expiredLine,
  factFormProblems,
  factSubmitReason,
  importFileUrl,
  openingFactForm,
  plainText,
  proposeBody,
  proposeFailure,
  proposedToast,
  provenanceLinks,
  removeAnchor,
  setAnchor,
  sourceLine,
  staleChip,
  staleLine,
  statusChip,
  ticketTrackerUrl,
  transitionFailure,
  usedLabel,
  verbsFor,
} from "@/app/knowledge/facts";
import { KNOWLEDGE_ORIGIN } from "@/app/runs/origin";

import {
  CITED_PR_ID,
  CITED_RUN_ID,
  READ_AT,
  SEEDED_REPO,
  fact,
  seededFact,
  seededFacts,
  seededTickets,
  staleFact,
} from "../helpers/knowledge";

/**
 * The learned-facts card's judgements (#419): the five seeded rows come out as mockup 14 draws
 * them — with the honest MVP provenance on the correction-note one — every ref becomes a link
 * exactly when there is somewhere to go, every refusal becomes a sentence, and the add dialog's
 * form is checked before a round trip.
 */

const NOW = new Date(READ_AT);

describe("the head", () => {
  it("counts the proposals as the mockup's `2 awaiting review`, and says all reviewed when none wait", () => {
    expect(awaitingChip(seededFacts().counts)).toEqual({ text: "2 awaiting review", tone: "warn" });
    expect(awaitingChip({ proposed: 0, confirmed: 3, rejected: 1, stale: 0, expired: 1 })).toEqual({
      text: ALL_REVIEWED,
      tone: "neutral",
    });
    expect(awaitingChip({ proposed: 0, confirmed: 0, rejected: 0, stale: 0, expired: 0 })).toBeNull();
  });

  it("adds a stale chip when the sweep flagged something", () => {
    expect(staleChip(seededFacts().counts)).toBeNull();
    expect(staleChip({ ...seededFacts().counts, stale: 1 })).toEqual({ text: "1 stale", tone: "warn" });
  });
});

describe("the text", () => {
  it("splits inline code out of the sentence at its backticks", () => {
    expect(codeSpans("CI needs `west update` before first build of the day")).toEqual([
      { kind: "text", value: "CI needs " },
      { kind: "code", value: "west update" },
      { kind: "text", value: " before first build of the day" },
    ]);
    expect(codeSpans("Tests under `tests/hil/` require rig reservation via `rig claim`")).toEqual([
      { kind: "text", value: "Tests under " },
      { kind: "code", value: "tests/hil/" },
      { kind: "text", value: " require rig reservation via " },
      { kind: "code", value: "rig claim" },
    ]);
    expect(codeSpans("`CONFIG_LEGACY_TIMER` first")).toEqual([
      { kind: "code", value: "CONFIG_LEGACY_TIMER" },
      { kind: "text", value: " first" },
    ]);
  });

  it("reads an unpaired backtick as prose, and plain text as one run", () => {
    expect(codeSpans("no code here")).toEqual([{ kind: "text", value: "no code here" }]);
    expect(codeSpans("odd `one")).toEqual([
      { kind: "text", value: "odd " },
      { kind: "text", value: "`one" },
    ]);
    expect(codeSpans("trailing `")).toEqual([
      { kind: "text", value: "trailing " },
      { kind: "text", value: "`" },
    ]);
  });

  it("strips the backticks for an accessible name", () => {
    expect(plainText("CI needs `west update` before first build of the day")).toBe(
      "CI needs west update before first build of the day",
    );
  });
});

describe("provenance", () => {
  const tickets = seededTickets();

  it("links a run and a PR to their pages here, keeping Knowledge lit", () => {
    const links = provenanceLinks(seededFact("Team"), tickets);

    expect(links).toEqual([
      { label: "run", href: runPath(CITED_RUN_ID, KNOWLEDGE_ORIGIN.id), external: false },
      { label: "PR", href: prPath(CITED_PR_ID, KNOWLEDGE_ORIGIN.id), external: false },
    ]);
    expect(links[0]?.href).toContain("?from=knowledge");
    expect(KNOWLEDGE_ORIGIN.route).toBe(KNOWLEDGE_PATH);
  });

  it("links a ticket to its tracker page as the page resolved it, and says so when it could not", () => {
    expect(provenanceLinks(seededFact("CI"), tickets)).toEqual([
      { label: "#552", href: `https://github.com/${SEEDED_REPO}/issues/552`, external: true },
    ]);
    expect(provenanceLinks(seededFact("CI"), {})).toEqual([{ label: TICKET_UNRESOLVED, href: null, external: false }]);
  });

  it("links an imported fact to its file on the host, by section", () => {
    expect(provenanceLinks(seededFact("Zephyr"), tickets)).toEqual([
      { label: "CLAUDE.md § Kconfig", href: `https://github.com/${SEEDED_REPO}/blob/HEAD/CLAUDE.md`, external: true },
    ]);
    // A workspace-wide fact names no host: the ref is text.
    expect(provenanceLinks({ ...seededFact("Zephyr"), repoRef: null }, tickets)).toEqual([
      { label: "CLAUDE.md § Kconfig", href: null, external: true },
    ]);
  });

  it("draws no link for a ref with no page — a classification is reached through its run", () => {
    const links = provenanceLinks(seededFact("Team"), tickets);

    expect(links.map((link) => link.label)).not.toContain("classification");
    expect(provenanceLinks(fact({ provenance: { line: "x", refs: [{ kind: "steer", id: "s" }, { kind: "person", id: "p" }] } }), tickets)).toEqual([]);
  });

  it("builds tracker and file URLs only from a repository that reads as owner/name", () => {
    expect(ticketTrackerUrl("acme-robotics/helios-firmware", 552)).toBe("https://github.com/acme-robotics/helios-firmware/issues/552");
    expect(ticketTrackerUrl("not-a-repo", 552)).toBeNull();
    expect(ticketTrackerUrl("a/../b", 1)).toBeNull();
    expect(ticketTrackerUrl("acme-robotics/helios-firmware", 0)).toBeNull();
    expect(ticketTrackerUrl("acme-robotics/helios-firmware", 1.5)).toBeNull();
    expect(importFileUrl("acme-robotics/helios-firmware", "docs/RULES.md")).toBe(
      "https://github.com/acme-robotics/helios-firmware/blob/HEAD/docs/RULES.md",
    );
    expect(importFileUrl("acme-robotics/helios-firmware", "a b.md")).toBe(
      "https://github.com/acme-robotics/helios-firmware/blob/HEAD/a%20b.md",
    );
    expect(importFileUrl(null, "CLAUDE.md")).toBeNull();
    expect(importFileUrl("acme-robotics/helios-firmware", "")).toBeNull();
  });
});

describe("the stamps", () => {
  it("names the decider and the age — the mockup's `confirmed by Ken, 6w ago`", () => {
    expect(confirmedBy(seededFact("CI"), NOW)).toBe("confirmed by Ken, 6w ago");
    expect(confirmedBy(seededFact("Tests"), NOW)).toBe("confirmed by Maya, 3w ago");
    expect(confirmedBy(seededFact("Team"), NOW)).toBeNull();
    expect(confirmedBy({ ...seededFact("CI"), confirmation: { actor: null, at: seededFact("CI").confirmation!.at, reason: null } }, NOW)).toBe(
      "confirmed 6w ago",
    );
    expect(confirmedBy({ ...seededFact("CI"), confirmation: { actor: { id: null, name: null }, at: seededFact("CI").confirmation!.at, reason: null } }, NOW)).toBe(
      "confirmed 6w ago",
    );
  });

  it("draws the five source lines as the mockup does, with the honest MVP phrasing", () => {
    const lines = seededFacts().items.map((one) => sourceLine(one, NOW));

    expect(lines).toEqual([
      "from correction note (run #1847)",
      "observed in loop #1847",
      "from PR #498 review cycle · confirmed by Maya, 3w ago",
      "from build-farm failure pattern · confirmed by Ken, 6w ago",
      "expired on Zephyr 4.1 migration · was used 31×",
    ]);
    expect(lines[0]).not.toMatch(/review cycle/);
  });

  it("names the anchor change that flagged a stale fact, and keeps its confirmation", () => {
    expect(staleLine(staleFact(), NOW)).toBe(
      "flagged stale 3d ago: path_glob anchor tests/hil/** matched: renamed tests/hil/rig.py (PR #540)",
    );
    expect(sourceLine(staleFact(), NOW)).toBe("from PR #498 review cycle · confirmed by Maya, 3w ago");
    expect(staleLine(seededFact("CI"), NOW)).toBeNull();
    expect(staleLine({ ...staleFact(), staleness: { actor: null, at: READ_AT, reason: null } }, NOW)).toBe(
      `flagged stale 0s ago: ${STALE_NO_REASON}`,
    );
  });

  it("reads the expired row's reason and snapshot, and never invents either", () => {
    expect(expiredLine(seededFact("Zephyr"))).toBe("expired on Zephyr 4.1 migration · was used 31×");
    expect(expiredLine({ ...seededFact("Zephyr"), expiry: null })).toBe("expired");
    expect(usedLabel(48)).toBe("used 48×");
  });
});

describe("the status cluster", () => {
  it("wears the mockup's pills", () => {
    expect(statusChip("proposed")).toEqual({ text: "awaiting review", tone: "warn" });
    expect(statusChip("confirmed")).toEqual({ text: "✓ confirmed", tone: "ok" });
    expect(statusChip("stale")).toEqual({ text: "stale", tone: "warn" });
    expect(statusChip("expired")).toEqual({ text: "expired", tone: "neutral" });
    expect(statusChip("rejected")).toEqual({ text: "rejected", tone: "neutral" });
  });

  it("offers decision K3's edges and nothing else", () => {
    expect(verbsFor("proposed")).toEqual(["confirm", "reject"]);
    expect(verbsFor("stale")).toEqual(["reconfirm", "expire"]);
    expect(verbsFor("expired")).toEqual(["relearn"]);
    expect(verbsFor("confirmed")).toEqual([]);
    expect(verbsFor("rejected")).toEqual([]);
  });

  it("names each action by its fact, so two rows' Confirms read apart", () => {
    expect(actionName("confirm", seededFact("Team"))).toBe("Confirm: Team prefers k_msgq over k_fifo in ISR paths");
    expect(actionName("relearn", seededFact("Zephyr"))).toBe("Re-learn: Zephyr 4.0 needs CONFIG_LEGACY_TIMER");
  });

  it("turns a refusal into the row's sentence", () => {
    expect(
      transitionFailure({ code: "fact_transition_refused", message: "A rejected fact cannot be confirmed.", details: { from: "rejected", to: "confirmed" } }),
    ).toBe("Not changed: A rejected fact cannot be confirmed.");
    expect(transitionFailure({ code: "fact_changed", message: "Moved.", details: {} })).toMatch(/^Not changed: this fact moved under someone else/);
    expect(transitionFailure({ code: "forbidden", message: "Forbidden.", details: {} })).toBe(`Not changed: ${VIEWER_REASON}`);
  });

  it("announces what each transition did", () => {
    expect(announcement("confirm", seededFact("Team"))).toBe("Confirmed: Team prefers k_msgq over k_fifo in ISR paths");
    expect(announcement("reject", seededFact("PID"))).toBe("Rejected: PID gains live in config/control.yaml, not in headers");
    expect(announcement("reconfirm", staleFact())).toMatch(/^Re-confirmed: /);
    expect(announcement("expire", staleFact())).toMatch(/^Expired: /);
    expect(announcement("relearn", seededFact("Zephyr"))).toBe("Re-learned as a new proposal: Zephyr 4.0 needs CONFIG_LEGACY_TIMER");
    expect(RELEARNED_NOTE).toMatch(/stays expired/);
  });
});

describe("the add dialog", () => {
  it("opens empty, and edits its anchors as values", () => {
    const form = openingFactForm();

    expect(form).toEqual({ text: "", repoRef: "", provenanceLine: "", anchors: [] });

    const one = addAnchor(form);
    expect(one.anchors).toEqual([{ kind: "path_glob", value: "" }]);

    const set = setAnchor(addAnchor(one), 1, { kind: "dependency", value: "west" });
    expect(set.anchors).toEqual([{ kind: "path_glob", value: "" }, { kind: "dependency", value: "west" }]);
    expect(removeAnchor(set, 0).anchors).toEqual([{ kind: "dependency", value: "west" }]);
    expect(form.anchors).toEqual([]);
  });

  it("refuses an empty sentence, a long one, an empty anchor and a duplicate before a round trip", () => {
    expect(factSubmitReason(factFormProblems(openingFactForm()))).toBe(FACT_TEXT_REQUIRED);
    expect(factSubmitReason(factFormProblems({ ...openingFactForm(), text: "x".repeat(FACT_TEXT_MAX + 1) }))).toBe(FACT_TEXT_LONG);
    expect(factSubmitReason(factFormProblems({ ...openingFactForm(), text: "x".repeat(FACT_TEXT_MAX) }))).toBeUndefined();

    const empty = addAnchor({ ...openingFactForm(), text: "A fact" });
    expect(factFormProblems(empty).anchors).toEqual([ANCHOR_VALUE_REQUIRED]);
    expect(factSubmitReason(factFormProblems(empty))).toBe(ANCHOR_VALUE_REQUIRED);

    const twice = {
      ...openingFactForm(),
      text: "A fact",
      anchors: [{ kind: "dependency" as const, value: "west" }, { kind: "dependency" as const, value: " west " }],
    };
    expect(factFormProblems(twice).anchors).toEqual([null, ANCHOR_DUPLICATE]);
  });

  it("sends a trimmed body with the optional fields left out when empty", () => {
    expect(proposeBody({ ...openingFactForm(), text: "  A fact  " })).toEqual({ text: "A fact" });
    expect(
      proposeBody({
        text: "A fact",
        repoRef: SEEDED_REPO,
        provenanceLine: " from the bench ",
        anchors: [{ kind: "platform_version", value: " zephyr-4.0 " }],
      }),
    ).toEqual({
      text: "A fact",
      repoRef: SEEDED_REPO,
      provenanceLine: "from the bench",
      anchors: [{ kind: "platform_version", value: "zephyr-4.0" }],
    });
  });

  it("lands a refused anchor under the anchor the service named", () => {
    const form = { ...openingFactForm(), text: "A fact", anchors: [{ kind: "path_glob" as const, value: "a/**" }, { kind: "dependency" as const, value: "west" }] };

    expect(
      proposeFailure({ code: "fact_anchor_invalid", message: "Not a dependency.", details: { kind: "dependency", value: "west" } }, form),
    ).toEqual({ message: "Not a dependency.", anchorIndex: 1 });
    expect(proposeFailure({ code: "fact_anchor_exists", message: "Twice.", details: { kind: "path_glob", value: "a/**" } }, form)).toEqual({
      message: "Twice.",
      anchorIndex: 0,
    });
    expect(proposeFailure({ code: "fact_anchor_invalid", message: "?", details: { kind: "dependency", value: "other" } }, form).anchorIndex).toBeNull();
    expect(proposeFailure({ code: "forbidden", message: "Forbidden.", details: {} }, form)).toEqual({ message: VIEWER_REASON, anchorIndex: null });
    expect(proposeFailure({ code: "fact_provenance_unresolved", message: "No such run.", details: {} }, form)).toEqual({
      message: "No such run.",
      anchorIndex: null,
    });
  });

  it("leaves a toast that says the proposal waits and nothing is injected", () => {
    expect(proposedToast(fact({ text: "Use `k_msgq`" }))).toEqual({
      text: "Fact proposed: “Use k_msgq”. It is awaiting review; nothing is injected until it is confirmed.",
      links: [],
    });
  });
});
