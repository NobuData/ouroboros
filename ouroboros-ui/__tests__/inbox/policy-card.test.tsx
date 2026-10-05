import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { InboxPolicyCard } from "@/app/api/inbox";
import { PolicyCard } from "@/app/inbox/policy-card";

import { policyRow, seededPolicyCard } from "../helpers/inbox";

/**
 * **What Needs A Human** (BO.4, #469): every row is one BN.4 composed from a config that enforces
 * it — there is no list in the component — with the source behind an ⓘ, a link to the surface
 * that owns it, and the service's own caption.
 */

/** Render the card over a payload. */
function card(payload: InboxPolicyCard | null = seededPolicyCard(), failure: string | null = null) {
  return render(<PolicyCard card={payload} failure={failure} />);
}

/** The card's region. */
const region = () => screen.getByRole("region", { name: "What needs a human" });

/** The rows, in order. */
const rows = () => within(region()).queryAllByRole("listitem");

/** One row, by its rule. */
function row(rule: string): HTMLElement {
  const found = rows().find((item) => item.querySelector(".inbox-rules__rule")?.textContent === rule);

  if (found === undefined) throw new Error(`no row for ${rule}`);

  return found;
}

/** Each row as `rule → outcome`. */
const lines = () =>
  rows().map(
    (item) =>
      `${item.querySelector(".inbox-rules__rule")!.textContent} → ${item
        .querySelector(".inbox-rules__outcome")!
        .textContent.replace(/^→\s*leads to\s*/, "")}`,
  );

describe("the rows", () => {
  it("are the service's, in its order, as rule → outcome", () => {
    card();

    expect(lines()).toEqual([
      "refactor label → human review",
      "protected paths → allow-once",
      "unverifiable claims → explicit waiver",
    ]);
  });

  it("read as a sentence to a screen reader, the arrow included", () => {
    card();

    expect(row("refactor label").querySelector(".inbox-rules__outcome")).toHaveTextContent(
      "→ leads to human review",
    );
    expect(row("refactor label").querySelector(".inbox-rules__arrow")).toHaveAttribute("aria-hidden", "true");
  });

  it("drop a rule the moment the service stops listing it — removing the refactor-label policy removes its row", () => {
    const { rerender } = card();

    expect(lines()).toContain("refactor label → human review");

    rerender(
      <PolicyCard
        card={seededPolicyCard({
          rows: seededPolicyCard().rows.filter((each) => each.id !== "human_review:label:refactor"),
        })}
        failure={null}
      />,
    );

    expect(lines()).toEqual(["protected paths → allow-once", "unverifiable claims → explicit waiver"]);
    expect(region().textContent).not.toContain("refactor label");
  });

  it("change a row's text when its config changes — editing a protected path", () => {
    const { rerender } = card();

    expect(row("protected paths").querySelector(".inbox-rules__detail")).toHaveTextContent("boot/** · keys/**");

    rerender(
      <PolicyCard
        card={seededPolicyCard({
          rows: seededPolicyCard().rows.map((each) =>
            each.id === "protected_paths" ? { ...each, detail: "boot/** · keys/** · ota/manifest.json" } : each,
          ),
        })}
        failure={null}
      />,
    );

    expect(row("protected paths").querySelector(".inbox-rules__detail")).toHaveTextContent(
      "boot/** · keys/** · ota/manifest.json",
    );
  });

  it("have no detail line where the rule has none", () => {
    card();

    expect(row("refactor label").querySelector(".inbox-rules__detail")).toBeNull();
  });

  it("list a rule this client has never heard of, in the service's words", () => {
    card(
      seededPolicyCard({
        rows: [policyRow({ id: "human_review:effort", rule: "effort XL+", outcome: "human review" })],
      }),
    );

    expect(lines()).toEqual(["effort XL+ → human review"]);
  });
});

describe("the spend row", () => {
  it("is absent while nothing enforces it — no row, no placeholder, no greyed rule", () => {
    card();

    expect(region().textContent).not.toMatch(/spend/i);
    expect(region().textContent).not.toContain("$");
    expect(rows()).toHaveLength(3);
  });

  it("appears the day the service lists it, with no change here", () => {
    card(
      seededPolicyCard({
        rows: [
          ...seededPolicyCard().rows,
          policyRow({
            id: "spend_guard",
            rule: "spend > $2.50/run",
            outcome: "approval",
            source: "Org policy v7 · spend_guard",
          }),
        ],
      }),
    );

    expect(lines()).toContain("spend > $2.50/run → approval");
  });
});

describe("each row's source", () => {
  it("is behind a button the keyboard reaches, and says what enforces the rule", () => {
    card();

    for (const each of seededPolicyCard().rows) {
      const control = within(row(each.rule)).getByRole("button", { name: `Where this is enforced: ${each.rule}` });

      expect(control.tagName).toBe("BUTTON");
      expect(control).toHaveAccessibleDescription(each.source);
      expect(within(row(each.rule)).getByRole("note")).toHaveTextContent(each.source);
    }
  });

  it("pins open on a press and closes on Escape", () => {
    card();

    const control = within(row("protected paths")).getByRole("button", {
      name: "Where this is enforced: protected paths",
    });

    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(control, { key: "Escape" });
    expect(control).toHaveAttribute("aria-expanded", "false");
  });

  it("ends the row's trailing cluster, with the note straight after the line — wherever the row wraps", () => {
    card();

    const line = row("refactor label").querySelector(".inbox-rules__line")!;
    const trail = line.querySelector(".inbox-rules__trail")!;

    // The outcome, the edit link and the control wrap as one: the ⓘ is never orphaned on a line.
    expect(line.lastElementChild).toBe(trail);
    expect([...trail.children].map((child) => child.className)).toEqual([
      "inbox-rules__outcome",
      "inbox-rules__edit",
      "inbox-tip__toggle",
    ]);
    expect(line.nextElementSibling).toBe(within(row("refactor label")).getByRole("note"));
  });

  it("is opened by its control alone: the rule, the outcome and the edit link are not controls of it", () => {
    card();

    const tip = row("refactor label").querySelector(".inbox-tip")!;

    expect(within(row("refactor label")).getAllByRole("button")).toHaveLength(1);
    expect(tip.querySelectorAll("[aria-describedby]")).toHaveLength(1);
    expect(within(row("refactor label")).getByRole("link", { name: "edit: refactor label" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

describe("each row's edit link", () => {
  it("lands on the surface that owns the rule — the service says which", () => {
    card();

    expect(within(row("refactor label")).getByRole("link", { name: "edit: refactor label" })).toHaveAttribute(
      "href",
      "/settings#policies",
    );
    expect(within(row("protected paths")).getByRole("link", { name: "edit: protected paths" })).toHaveAttribute(
      "href",
      "/knowledge#repo-profile",
    );
    expect(within(row("unverifiable claims")).getByRole("link", { name: "edit: unverifiable claims" })).toHaveAttribute(
      "href",
      "/settings#policies",
    );
  });

  it.each(["https://evil.test/settings", "//evil.test", "javascript:alert(1)", ""])(
    "is not drawn for %j — only a path on this site is followed",
    (editHref) => {
      card(seededPolicyCard({ rows: [policyRow({ editHref })] }));

      expect(within(row("refactor label")).queryByRole("link")).toBeNull();
      // The rule is still a rule: the row stays, with its source.
      expect(lines()).toEqual(["refactor label → human review"]);
    },
  );
});

describe("the caption", () => {
  it("is the service's sentence outside dry-run", () => {
    card();

    expect(region().querySelector(".inbox-rules__caption")).toHaveTextContent(
      "Everything else merges itself when gates are green.",
    );
  });

  it("changes truthfully when dry-run is flipped", () => {
    const { rerender } = card();
    const dryRun =
      "Dry-run is on: nothing merges itself — every loop's PR opens as a draft for a person to review.";

    rerender(<PolicyCard card={seededPolicyCard({ dryRun: true, caption: dryRun })} failure={null} />);

    expect(region().querySelector(".inbox-rules__caption")).toHaveTextContent(dryRun);
    expect(region().textContent).not.toContain("merges itself when gates are green");
  });
});

describe("Edit policies", () => {
  it("leads to the settings surface", () => {
    card();

    expect(within(region()).getByRole("link", { name: "Edit policies →" })).toHaveAttribute(
      "href",
      "/settings#policies",
    );
  });
});

describe("a card with nothing to list", () => {
  it("says no rule asks for a person, and still gives the caption", () => {
    card(seededPolicyCard({ rows: [] }));

    expect(rows()).toHaveLength(0);
    expect(within(region()).getByText("No rule asks for a person right now.")).toBeInTheDocument();
    expect(region().querySelector(".inbox-rules__caption")).toHaveTextContent(
      "Everything else merges itself when gates are green.",
    );
  });

  it("says why when it could not be read — and claims no rule and no caption", () => {
    card(null, "The inbox's channels and policies could not be reached.");

    expect(within(region()).getByText("The inbox's channels and policies could not be reached.")).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(region().querySelector(".inbox-rules__caption")).toBeNull();
    expect(within(region()).getByRole("link", { name: "Edit policies →" })).toBeInTheDocument();
  });
});
