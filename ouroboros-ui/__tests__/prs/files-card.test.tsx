import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PullRequestPage } from "@/app/api/pull-requests";
import { CRITERIA_TITLE, FILES_ID } from "@/app/prs/criteria";
import {
  EXCERPT_LABEL,
  FILES_TITLE,
  FLAGGED_LINK,
  FULL_DIFF_LINK,
  HUNK_NOT_IN_EXCERPT,
  NO_CHANGED_FILES,
  NO_EXCERPT,
  NO_FILES_SNAPSHOT,
  OUT_OF_SCOPE_TAG,
  excerptReach,
} from "@/app/prs/files";
import { GATES_TITLE } from "@/app/prs/gates";
import type { Hunk } from "@/app/prs/hunk";
import type { PrPollOptions } from "@/app/prs/poll";
import { PrScreen } from "@/app/prs/pr-screen";
import { DASHBOARD_ORIGIN } from "@/app/runs/origin";

import {
  FRAME_ORDER_PATH,
  HOST_EXCERPT,
  HOST_URL,
  ISR_PATH,
  PR_514_ID,
  TELEMETRY_PATH,
  filesPage,
  mockupFiles,
  outOfScopePage,
} from "../helpers/pull-requests";

/**
 * The Changed files card (#367), rendered in the PR screen: the seeded card against mockup 12,
 * the meters' proportions, the excerpt and its honesty, per-file expansion, the out-of-scope
 * rows and the gates card's link to them, and a hunk reference scrolling the diff to its range.
 */

// The Server Actions are never reached here.
vi.mock("@/app/prs/head-actions", () => ({
  decideApproval: vi.fn(),
  requestHumanReview: vi.fn(),
  returnToLoop: vi.fn(),
}));
vi.mock("@/app/prs/criteria-actions", () => ({
  addClaim: vi.fn(),
  attachEvidence: vi.fn(),
  importFromPlan: vi.fn(),
  readEvidenceOptions: vi.fn(),
  verifyClaim: vi.fn(),
  waiveClaim: vi.fn(),
}));
vi.mock("@/app/prs/thread-actions", () => ({
  resolveEntry: vi.fn(),
}));
vi.mock("@/app/prs/merge-actions", () => ({
  armPlan: vi.fn(),
  disarmPlan: vi.fn(),
  editPlan: vi.fn(),
  mergeNow: vi.fn(),
}));

/** A poll that never answers — the page shows the server's first read. */
const QUIET: PrPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** The address the page is opened at. */
const ADDRESS = `/prs/${PR_514_ID}?from=dashboard`;

/** What `scrollIntoView` was called on, in order. */
let scrolled: Element[] = [];

/**
 * Draw the screen.
 *
 * @param initial The page.
 * @param initialHunk The hunk the address cites.
 * @returns The Testing Library render result.
 */
function draw(initial: PullRequestPage = filesPage(), initialHunk: Hunk | null = null) {
  return render(
    <PrScreen
      initial={initial}
      initialError={null}
      initialHunk={initialHunk}
      mayContribute
      origin={DASHBOARD_ORIGIN}
      poll={QUIET}
      prId={PR_514_ID}
    />,
  );
}

/** The card. */
function card(): HTMLElement {
  return screen.getByRole("region", { name: FILES_TITLE });
}

/**
 * The row of a changed file.
 *
 * @param path The file's path.
 * @returns The row.
 */
function row(path: string): HTMLElement {
  const found = [...card().querySelectorAll<HTMLElement>(".prv-file")].find(
    (each) => each.querySelector(".prv-file__path")?.textContent === path,
  );
  if (found === undefined) throw new Error(`no row for ${path}`);

  return found;
}

/**
 * A row's meter, as drawn.
 *
 * @param path The file's path.
 * @returns The widths of the additions' and the deletions' segments, and where the latter starts.
 */
function meter(path: string): { add: string | null; del: string | null; delAt: string | null } {
  const bar = row(path).querySelector(".prv-file__meter") as SVGElement;

  return {
    add: bar.querySelector(".prv-file__meter-add")!.getAttribute("width"),
    del: bar.querySelector(".prv-file__meter-del")!.getAttribute("width"),
    delAt: bar.querySelector(".prv-file__meter-del")!.getAttribute("x"),
  };
}

/**
 * A file's disclosure in the excerpt.
 *
 * @param path The file's path.
 * @returns The button.
 */
function toggle(path: string): HTMLElement {
  return within(card()).getByRole("button", { name: path });
}

/** The excerpt's lines on screen, as `[class, text]`. */
function lines(): [string, string][] {
  return [...card().querySelectorAll(".prv-diff__line")].map((line) => [
    line.className,
    line.textContent ?? "",
  ]);
}

beforeEach(() => {
  window.history.replaceState(null, "", ADDRESS);
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});

describe("the seeded card", () => {
  it("draws mockup 12's header: the title, the totals and the host link", () => {
    draw();

    expect(card()).toHaveAttribute("id", FILES_ID);
    expect(within(card()).getByRole("heading", { name: FILES_TITLE })).toBeInTheDocument();
    expect(within(card()).getByText("+68 −15")).toHaveClass("ou-tag");

    const link = within(card()).getByRole("link", { name: new RegExp(FULL_DIFF_LINK) });

    expect(link).toHaveAttribute("href", `${HOST_URL}/files`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("draws the three rows: mono path, and counts in the ok and err classes", () => {
    draw();

    expect(
      [...card().querySelectorAll(".prv-file__path")].map((each) => each.textContent),
    ).toEqual([TELEMETRY_PATH, ISR_PATH, FRAME_ORDER_PATH]);

    const telemetry = row(TELEMETRY_PATH);

    expect(within(telemetry).getByText("+38")).toHaveClass("prv-file__add");
    expect(within(telemetry).getByText("−12")).toHaveClass("prv-file__del");
    expect(within(row(FRAME_ORDER_PATH)).getByText("−0")).toHaveClass("prv-file__del");
  });

  it("draws meters that differ by file magnitude, scaled against the largest file", () => {
    draw();

    expect(meter(TELEMETRY_PATH)).toEqual({ add: "76", del: "24", delAt: "76" });
    expect(meter(ISR_PATH)).toEqual({ add: "18", del: "6", delAt: "18" });
    expect(meter(FRAME_ORDER_PATH)).toEqual({ add: "42", del: "0", delAt: "42" });
  });

  it("hides the meter from the accessibility tree: the counts beside it say the same", () => {
    draw();

    const bar = row(TELEMETRY_PATH).querySelector(".prv-file__meter");

    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(bar).toHaveAttribute("viewBox", "0 0 100 1");
  });

  it("flags nothing while diff-vs-plan is green", () => {
    draw();

    expect(card().querySelector(".prv-file--flagged")).toBeNull();
    expect(card()).not.toHaveTextContent(OUT_OF_SCOPE_TAG);
    expect(card().querySelector(".prv-files__scope")).toBeNull();
  });
});

describe("the excerpt", () => {
  it("renders the header and the del, add and ctx treatments", () => {
    draw();

    expect(lines()).toEqual([
      [
        "prv-diff__line prv-diff__line--head",
        `@@ ${TELEMETRY_PATH}:41 @@ static void can_isr_rx(const struct device *dev)`,
      ],
      ["prv-diff__line prv-diff__line--ctx", "     struct tlm_frame *slot = tlm_slot_claim();"],
      ["prv-diff__line prv-diff__line--del", "-    slot->ts = k_cycle_get_32();"],
      ["prv-diff__line prv-diff__line--del", "-    k_fifo_put(&telemetry_fifo, slot);"],
      ["prv-diff__line prv-diff__line--add", "+    slot->ts  = k_cycle_get_32();"],
      [
        "prv-diff__line prv-diff__line--add",
        "+    slot->seq = (uint16_t)atomic_inc(&tlm_seq);   /* ISR-ordered */",
      ],
      ["prv-diff__line prv-diff__line--add", "+    k_msgq_put(&telemetry_msgq, slot, K_NO_WAIT);"],
    ]);
  });

  it("is labelled as an excerpt, and says how far it reaches", () => {
    draw();

    expect(card()).toHaveTextContent(EXCERPT_LABEL);
    expect(card()).toHaveTextContent(excerptReach(1, 3));
  });

  it("scrolls inside its own wrapper", () => {
    draw();

    const block = card().querySelector(".prv-diff__block") as HTMLElement;

    expect(block.tagName).toBe("PRE");
    expect(block.parentElement).toHaveClass("prv-diff__scroll");
  });

  it("opens and closes file by file, within what is stored", () => {
    draw(filesPage({ files: mockupFiles({ diffExcerpt: HOST_EXCERPT }) }));

    expect(toggle(TELEMETRY_PATH)).toHaveAttribute("aria-expanded", "true");
    expect(toggle(ISR_PATH)).toHaveAttribute("aria-expanded", "false");
    expect(toggle(ISR_PATH)).not.toHaveAttribute("aria-controls");
    expect(card()).not.toHaveTextContent("#define FAST 1");

    fireEvent.click(toggle(ISR_PATH));

    expect(toggle(ISR_PATH)).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(toggle(ISR_PATH).getAttribute("aria-controls")!)).toHaveClass(
      "prv-diff__scroll",
    );
    expect(card()).toHaveTextContent("#define FAST 1");
    expect(card()).toHaveTextContent("k_msgq_put");

    fireEvent.click(toggle(TELEMETRY_PATH));

    expect(toggle(TELEMETRY_PATH)).toHaveAttribute("aria-expanded", "false");
    expect(card()).not.toHaveTextContent("k_msgq_put");
    expect(card()).toHaveTextContent("#define FAST 1");
  });

  it("says when no excerpt is stored, and still draws the rows and the link", () => {
    draw(filesPage({ files: mockupFiles({ diffExcerpt: null }) }));

    expect(card()).toHaveTextContent(NO_EXCERPT);
    expect(card()).not.toHaveTextContent(EXCERPT_LABEL);
    expect(card().querySelector(".prv-diff")).toBeNull();
    expect(card().querySelectorAll(".prv-file")).toHaveLength(3);
    expect(within(card()).getByRole("link", { name: new RegExp(FULL_DIFF_LINK) })).toBeVisible();
  });

  it("says when the revision changed no file, and when there is no revision", () => {
    const none = draw(filesPage({ files: mockupFiles({ rows: [], diffExcerpt: null }) }));

    expect(card()).toHaveTextContent(NO_CHANGED_FILES);
    none.unmount();

    draw(filesPage({ files: null }));

    expect(card()).toHaveTextContent(NO_FILES_SNAPSHOT);
    expect(within(card()).queryByRole("link")).toBeNull();
  });
});

describe("out-of-scope rows", () => {
  it("carry the err tint and the explanation naming the plan", () => {
    draw(outOfScopePage());

    expect(row(ISR_PATH)).toHaveClass("prv-file--flagged");
    expect(row(ISR_PATH)).toHaveTextContent(OUT_OF_SCOPE_TAG);
    expect(row(TELEMETRY_PATH)).not.toHaveClass("prv-file--flagged");
    expect(row(TELEMETRY_PATH)).not.toHaveTextContent(OUT_OF_SCOPE_TAG);
    expect(card().querySelector(".prv-files__scope")).toHaveTextContent(
      "Diff vs plan is red on this revision: 1 changed file falls outside the planned file list of the plan of issue #482.",
    );
  });

  it("are deep-linked from the gates card: the first flagged row scrolls into view, the card takes focus", () => {
    draw(outOfScopePage());

    const gates = screen.getByRole("region", { name: GATES_TITLE });
    const link = within(gates).getByRole("link", { name: FLAGGED_LINK.label });

    expect(link).toHaveAttribute("href", `#${FILES_ID}`);
    expect(link.closest("li")).toHaveTextContent("Diff vs plan");
    expect(scrolled).toEqual([]);

    fireEvent.click(link);

    expect(scrolled).toEqual([row(ISR_PATH)]);
    expect(card()).toHaveFocus();
  });

  it("leave a press that asks for a new tab to the browser", () => {
    draw(outOfScopePage());

    let claimed: boolean | null = null;
    const observe = (event: MouseEvent): void => {
      claimed = event.defaultPrevented;
      event.preventDefault();
    };

    document.addEventListener("click", observe);
    fireEvent.click(
      within(screen.getByRole("region", { name: GATES_TITLE })).getByRole("link", {
        name: FLAGGED_LINK.label,
      }),
      { metaKey: true },
    );
    document.removeEventListener("click", observe);

    expect(claimed).toBe(false);
    expect(scrolled).toEqual([]);
  });

  it("bring the reader to the card itself when the gate's line names no row", () => {
    draw(outOfScopePage("1 out-of-scope edit: west.yml"));

    fireEvent.click(
      within(screen.getByRole("region", { name: GATES_TITLE })).getByRole("link", {
        name: FLAGGED_LINK.label,
      }),
    );

    expect(scrolled).toEqual([card()]);
    expect(card().querySelector(".prv-file--flagged")).toBeNull();
    expect(card().querySelector(".prv-files__scope")).toHaveTextContent("west.yml");
  });

  it("are not linked from a green gate, nor from another revision's gates", () => {
    const green = draw();

    expect(screen.queryByRole("link", { name: FLAGGED_LINK.label })).toBeNull();
    green.unmount();

    render(
      <PrScreen
        initial={outOfScopePage()}
        initialError={null}
        initialRevision={1}
        origin={DASHBOARD_ORIGIN}
        poll={QUIET}
        prId={PR_514_ID}
      />,
    );

    expect(screen.queryByRole("link", { name: FLAGGED_LINK.label })).toBeNull();
    // The files are the latest revision's, and so are their flags.
    expect(row(ISR_PATH)).toHaveClass("prv-file--flagged");
  });
});

describe("a hunk reference", () => {
  const CITED: Hunk = { path: TELEMETRY_PATH, lineStart: 41, lineEnd: 66 };

  /** The first cited line on screen. */
  function anchor(): Element | null {
    return card().querySelector("[data-cited-anchor]");
  }

  it("from the matrix scrolls the diff to the range, marks it, and moves focus to the card", () => {
    draw();

    expect(card().querySelector(".prv-diff__line--cited")).toBeNull();

    fireEvent.click(
      within(screen.getByRole("region", { name: CRITERIA_TITLE })).getByRole("link", {
        name: "hunk telemetry_buf.c:41–66",
      }),
    );

    expect(card()).toHaveTextContent(`Cited: ${TELEMETRY_PATH} · lines 41–66`);
    expect(card().querySelectorAll(".prv-diff__line--cited")).toHaveLength(6);
    expect(anchor()).toHaveTextContent("struct tlm_frame *slot = tlm_slot_claim();");
    expect(scrolled).toEqual([anchor()]);
    expect(card()).toHaveFocus();
  });

  it("in the address scrolls to the range on arrival, and leaves focus where it was", () => {
    draw(filesPage(), CITED);

    expect(scrolled).toEqual([anchor()]);
    expect(anchor()).not.toBeNull();
    expect(card()).not.toHaveFocus();
  });

  it("opens the cited file again after the reader closed it", () => {
    draw();

    fireEvent.click(toggle(TELEMETRY_PATH));
    expect(anchor()).toBeNull();

    fireEvent.click(
      within(screen.getByRole("region", { name: CRITERIA_TITLE })).getByRole("link", {
        name: "hunk telemetry_buf.c:41–66",
      }),
    );

    expect(toggle(TELEMETRY_PATH)).toHaveAttribute("aria-expanded", "true");
    expect(scrolled).toEqual([anchor()]);

    // Followed once more after closing it again: the same citation still opens the file.
    fireEvent.click(toggle(TELEMETRY_PATH));
    fireEvent.click(
      within(screen.getByRole("region", { name: CRITERIA_TITLE })).getByRole("link", {
        name: "hunk telemetry_buf.c:41–66",
      }),
    );

    expect(toggle(TELEMETRY_PATH)).toHaveAttribute("aria-expanded", "true");
    expect(scrolled).toHaveLength(2);
  });

  it("says when the excerpt does not reach the range, and brings the card into view", () => {
    draw(filesPage(), { path: ISR_PATH, lineStart: 5, lineEnd: 9 });

    expect(card()).toHaveTextContent(`Cited: ${ISR_PATH} · lines 5–9`);
    expect(card()).toHaveTextContent(HUNK_NOT_IN_EXCERPT);
    expect(anchor()).toBeNull();
    expect(scrolled).toEqual([card()]);
  });
});
