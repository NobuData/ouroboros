import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Fact, FactList } from "@/app/api/facts";
import type { Reading } from "@/app/api/reading";
import { prPath, runPath } from "@/app/paths";
import {
  ADD_FACT_LABEL,
  ALL_REVIEWED,
  EXPIRE_CANCEL,
  EXPIRE_REASON_LABEL,
  EXPIRE_REASON_REQUIRED,
  EXPIRE_SUBMIT,
  FACTS_FOOT,
  FACTS_UNREAD_TITLE,
  NO_FACTS_TITLE,
  RELEARNED_NOTE,
  REVIEW_ALL,
  REVIEW_ALL_REASON,
  TICKET_UNRESOLVED,
  USED_NOTE,
  VIEWER_REASON,
  actionName,
} from "@/app/knowledge/facts";
import type { TicketLink } from "@/app/knowledge/view";

import {
  CITED_PR_ID,
  CITED_RUN_ID,
  KEN,
  READ_AT,
  SEEDED_REPO,
  seededFact,
  seededFacts,
  seededRepos,
  seededTickets,
  staleFact,
} from "../helpers/knowledge";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * Mockup 14's learned-facts card as it is drawn (#419): the five seeded rows in both palettes —
 * the struck-through expired one included — with inline code as code, provenance links that
 * resolve, the honest MVP phrasing, Confirm and Reject that round-trip and move the head's count,
 * the stale treatment with re-confirm and expire, Re-learn's new linked proposal, a viewer's inert
 * actions, the empty and all-reviewed states, and every control from the keyboard.
 */

const decideFact = vi.fn();
const proposeFact = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/knowledge/facts-actions", () => ({
  decideFact: (id: string, verb: string, reason?: string) => decideFact(id, verb, reason),
  proposeFact: (body: unknown) => proposeFact(body),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { FactsCard } = await import("@/app/knowledge/facts-card");

/**
 * Draw the card.
 *
 * @param over Props to replace.
 * @returns The render result, and the toast spy.
 */
function draw(
  over: Partial<{
    facts: Reading<FactList>;
    tickets: Readonly<Record<string, TicketLink>>;
    mayDecide: boolean;
  }> = {},
) {
  const onToast = vi.fn();
  const result = render(
    <FactsCard
      facts={{ ok: true, value: seededFacts() }}
      mayDecide
      onToast={onToast}
      readAt={READ_AT}
      repos={{ ok: true, value: seededRepos() }}
      tickets={seededTickets()}
      {...over}
    />,
  );

  return { ...result, onToast };
}

/**
 * The row carrying a fact's text.
 *
 * @param lead The text's first words.
 * @returns The `<li>`.
 */
function row(lead: string): HTMLElement {
  const item = screen.getAllByRole("listitem").find((one) => one.textContent?.includes(lead));
  if (item === undefined) throw new Error(`no row starting ${lead}`);

  return item;
}

/** The card's live region — polite, so it never interrupts the row's own alert. */
function announced(): HTMLElement {
  const region = document.querySelector('p[aria-live="polite"]');
  if (!(region instanceof HTMLElement)) throw new Error("no live region");

  return region;
}

beforeEach(() => {
  decideFact.mockReset();
  proposeFact.mockReset();
  refresh.mockReset();
});

describe("the five rows", () => {
  it("are the mockup's — text, source, pill, count — with the honest MVP provenance", () => {
    draw();

    expect(screen.getByText("2 awaiting review")).toHaveClass("ou-chip--warn");
    expect(screen.getByText(FACTS_FOOT)).toBeInTheDocument();

    const ci = row("CI needs");
    expect(ci).toHaveTextContent("from build-farm failure pattern · confirmed by Ken, 6w ago");
    expect(within(ci).getByText("✓ confirmed")).toHaveClass("ou-chip--ok");
    expect(within(ci).getByText("used 48×")).toHaveAttribute("title", USED_NOTE);

    const tests = row("Tests under");
    expect(tests).toHaveTextContent("from PR #498 review cycle · confirmed by Maya, 3w ago");
    expect(within(tests).getByText("used 12×")).toBeInTheDocument();

    const team = row("Team prefers");
    expect(team).toHaveTextContent("from correction note (run #1847)");
    expect(team).not.toHaveTextContent("review cycle");
    expect(within(team).getByText("awaiting review")).toHaveClass("ou-chip--warn");
    expect(within(team).getByRole("button", { name: actionName("confirm", seededFact("Team")) })).toHaveClass("ou-btn--primary");
    expect(within(team).getByRole("button", { name: actionName("reject", seededFact("Team")) })).toHaveClass("ou-btn--ghost");

    const pid = row("PID gains");
    expect(pid).toHaveTextContent("observed in loop #1847");

    const zephyr = row("Zephyr 4.0");
    expect(zephyr).toHaveClass("knowledge-facts__row--expired");
    expect(zephyr).toHaveTextContent("expired on Zephyr 4.1 migration · was used 31×");
    expect(within(zephyr).getByText("expired")).toHaveClass("ou-chip");
    expect(within(zephyr).getByRole("button", { name: actionName("relearn", seededFact("Zephyr")) })).toBeInTheDocument();
  });

  it("render inline code as code", () => {
    draw();

    const code = within(row("CI needs")).getByText("west update");

    expect(code.tagName).toBe("CODE");
    expect(within(row("Tests under")).getAllByRole("code", { hidden: true }).length).toBeGreaterThanOrEqual(0);
    expect(row("Tests under").querySelectorAll("code")).toHaveLength(2);
    expect(row("Zephyr 4.0").querySelector("code")).toHaveTextContent("CONFIG_LEGACY_TIMER");
  });

  it("render the same markup in both palettes — the sheet is what differs", () => {
    const [light, dark] = renderInBothPalettes(
      <FactsCard
        facts={{ ok: true, value: seededFacts() }}
        mayDecide
        onToast={vi.fn()}
        readAt={READ_AT}
        repos={{ ok: true, value: seededRepos() }}
        tickets={seededTickets()}
      />,
    );

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain("knowledge-facts__row--expired");
    expect(light).toContain("was used 31×");
  });

  it("keeps Review all → honest: inert, with the inbox named as where it will lead", () => {
    draw();

    const link = screen.getByRole("button", { name: REVIEW_ALL });

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("title", REVIEW_ALL_REASON);
    expect(screen.queryByRole("link", { name: REVIEW_ALL })).toBeNull();
  });
});

describe("provenance links", () => {
  it("resolve to the run, the PR, the ticket's tracker page and the imported file", () => {
    draw();

    const team = row("Team prefers");
    expect(within(team).getByRole("link", { name: "run ↗" })).toHaveAttribute("href", runPath(CITED_RUN_ID, "knowledge"));
    expect(within(team).getByRole("link", { name: "PR ↗" })).toHaveAttribute("href", prPath(CITED_PR_ID, "knowledge"));

    const ticket = within(row("CI needs")).getByRole("link", { name: "#552 ↗" });
    expect(ticket).toHaveAttribute("href", `https://github.com/${SEEDED_REPO}/issues/552`);
    expect(ticket).toHaveAttribute("target", "_blank");
    expect(ticket).toHaveAttribute("rel", "noreferrer");

    expect(within(row("Zephyr 4.0")).getByRole("link", { name: "CLAUDE.md § Kconfig ↗" })).toHaveAttribute(
      "href",
      `https://github.com/${SEEDED_REPO}/blob/HEAD/CLAUDE.md`,
    );
  });

  it("draw a ticket the page could not resolve as text, never as a dead link", () => {
    draw({ tickets: {} });

    const ci = row("CI needs");

    expect(ci).toHaveTextContent(TICKET_UNRESOLVED);
    expect(within(ci).queryByRole("link")).toBeNull();
  });
});

describe("Confirm and Reject", () => {
  it("confirm round-trips, records the actor, transitions the row in place and decrements the count", async () => {
    const team = seededFact("Team");
    const confirmed: Fact = { ...team, status: "confirmed", confirmation: { actor: KEN, at: READ_AT, reason: null }, usedCount: 0 };
    decideFact.mockResolvedValue({ ok: true, value: confirmed });
    draw();

    fireEvent.click(screen.getByRole("button", { name: actionName("confirm", team) }));

    expect(decideFact).toHaveBeenCalledExactlyOnceWith(team.id, "confirm", undefined);

    await waitFor(() => {
      expect(within(row("Team prefers")).getByText("✓ confirmed")).toBeInTheDocument();
    });
    expect(row("Team prefers")).toHaveTextContent("from correction note (run #1847) · confirmed by Ken, 0s ago");
    expect(within(row("Team prefers")).queryByRole("button", { name: actionName("confirm", team) })).toBeNull();
    expect(screen.getByText("1 awaiting review")).toBeInTheDocument();
    expect(announced()).toHaveTextContent("Confirmed: Team prefers k_msgq over k_fifo in ISR paths");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reject transitions the row to rejected, dimmed, and the count follows", async () => {
    const pid = seededFact("PID");
    decideFact.mockResolvedValue({ ok: true, value: { ...pid, status: "rejected" } });
    draw();

    fireEvent.click(screen.getByRole("button", { name: actionName("reject", pid) }));

    expect(decideFact).toHaveBeenCalledExactlyOnceWith(pid.id, "reject", undefined);

    await waitFor(() => {
      expect(within(row("PID gains")).getByText("rejected")).toBeInTheDocument();
    });
    expect(row("PID gains")).toHaveClass("knowledge-facts__row--rejected");
    expect(screen.getByText("1 awaiting review")).toBeInTheDocument();
    expect(announced()).toHaveTextContent("Rejected: PID gains live in config/control.yaml, not in headers");
  });

  it("reads all reviewed once the last proposal is decided", async () => {
    const team = seededFact("Team");
    const pid = seededFact("PID");
    decideFact
      .mockResolvedValueOnce({ ok: true, value: { ...team, status: "confirmed", confirmation: { actor: KEN, at: READ_AT, reason: null } } })
      .mockResolvedValueOnce({ ok: true, value: { ...pid, status: "rejected" } });
    draw();

    fireEvent.click(screen.getByRole("button", { name: actionName("confirm", team) }));
    await waitFor(() => { expect(screen.getByText("1 awaiting review")).toBeInTheDocument(); });
    fireEvent.click(screen.getByRole("button", { name: actionName("reject", pid) }));
    await waitFor(() => { expect(screen.getByText(ALL_REVIEWED)).toBeInTheDocument(); });
  });

  it("shows the service's refusal in the row, described by the button, and moves nothing", async () => {
    const team = seededFact("Team");
    decideFact.mockResolvedValue({
      ok: false,
      refusal: { code: "fact_transition_refused", message: "A rejected fact cannot be confirmed.", details: { from: "rejected", to: "confirmed" } },
    });
    draw();

    const button = screen.getByRole("button", { name: actionName("confirm", team) });
    fireEvent.click(button);

    const alert = await within(row("Team prefers")).findByRole("alert");

    expect(alert).toHaveTextContent("Not changed: A rejected fact cannot be confirmed.");
    expect(button).toHaveAttribute("aria-describedby", alert.id);
    expect(screen.getByText("2 awaiting review")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes one press at a time", async () => {
    decideFact.mockReturnValue(new Promise(() => {}));
    draw();

    fireEvent.click(screen.getByRole("button", { name: actionName("confirm", seededFact("Team")) }));
    fireEvent.click(screen.getByRole("button", { name: actionName("confirm", seededFact("PID")) }));

    await waitFor(() => {
      expect(decideFact).toHaveBeenCalledOnce();
    });
  });
});

describe("the stale row", () => {
  const stale = staleFact();
  const list = seededFacts([stale, ...seededFacts().items.filter((one) => one.id !== stale.id)]);

  it("names the anchor change that flagged it, keeps its confirmation, and offers re-confirm and expire", () => {
    draw({ facts: { ok: true, value: list } });

    const tests = row("Tests under");

    expect(screen.getByText("1 stale")).toHaveClass("ou-chip--warn");
    expect(within(tests).getByText("stale")).toHaveClass("ou-chip--warn");
    expect(tests).toHaveTextContent("flagged stale 3d ago: path_glob anchor tests/hil/** matched: renamed tests/hil/rig.py (PR #540)");
    expect(tests).toHaveTextContent("confirmed by Maya, 3w ago");
    expect(within(tests).getByRole("button", { name: actionName("reconfirm", stale) })).toHaveClass("ou-btn--primary");
    expect(within(tests).getByRole("button", { name: actionName("expire", stale) })).toBeInTheDocument();
  });

  it("re-confirms in one press", async () => {
    decideFact.mockResolvedValue({ ok: true, value: { ...stale, status: "confirmed", staleness: null } });
    draw({ facts: { ok: true, value: list } });

    fireEvent.click(screen.getByRole("button", { name: actionName("reconfirm", stale) }));

    expect(decideFact).toHaveBeenCalledExactlyOnceWith(stale.id, "reconfirm", undefined);
    await waitFor(() => {
      expect(within(row("Tests under")).getByText("✓ confirmed")).toBeInTheDocument();
    });
    expect(screen.queryByText("1 stale")).toBeNull();
  });

  it("expires with a reason it asks for first, and the row takes the expired treatment", async () => {
    decideFact.mockResolvedValue({
      ok: true,
      value: {
        ...stale,
        status: "expired",
        expiry: { reason: "rig retired", previousUseCount: 12, stamp: { actor: KEN, at: READ_AT, reason: "rig retired" } },
      },
    });
    draw({ facts: { ok: true, value: list } });

    fireEvent.click(screen.getByRole("button", { name: actionName("expire", stale) }));

    const field = screen.getByLabelText(EXPIRE_REASON_LABEL);
    const submit = screen.getByRole("button", { name: EXPIRE_SUBMIT });

    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAttribute("title", EXPIRE_REASON_REQUIRED);
    expect(decideFact).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "rig retired" } });
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.click(submit);

    expect(decideFact).toHaveBeenCalledExactlyOnceWith(stale.id, "expire", "rig retired");
    await waitFor(() => {
      expect(row("Tests under")).toHaveClass("knowledge-facts__row--expired");
    });
    expect(row("Tests under")).toHaveTextContent("expired on rig retired · was used 12×");
    expect(screen.queryByLabelText(EXPIRE_REASON_LABEL)).toBeNull();
    expect(announced()).toHaveTextContent(/^Expired: /);
  });

  it("keeps the fact when the expire is cancelled", () => {
    draw({ facts: { ok: true, value: list } });

    fireEvent.click(screen.getByRole("button", { name: actionName("expire", stale) }));
    fireEvent.click(screen.getByRole("button", { name: EXPIRE_CANCEL }));

    expect(screen.queryByLabelText(EXPIRE_REASON_LABEL)).toBeNull();
    expect(decideFact).not.toHaveBeenCalled();
  });
});

describe("Re-learn", () => {
  it("creates a new linked proposal at the top, says so under the expired row, and leaves it expired", async () => {
    const zephyr = seededFact("Zephyr");
    const fresh: Fact = {
      ...zephyr,
      id: "5eed0044-0000-4000-8000-000000000009",
      status: "proposed",
      confirmation: null,
      staleness: null,
      expiry: null,
      usedCount: 0,
      relearnedFromFactId: zephyr.id,
    };
    decideFact.mockResolvedValue({ ok: true, value: fresh });
    draw();

    fireEvent.click(screen.getByRole("button", { name: actionName("relearn", zephyr) }));

    expect(decideFact).toHaveBeenCalledExactlyOnceWith(zephyr.id, "relearn", undefined);

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(6);
    });

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Zephyr 4.0 needs");
    expect(items[0]).not.toHaveClass("knowledge-facts__row--expired");
    expect(within(items[0]!).getByText("awaiting review")).toBeInTheDocument();

    const expired = items.filter((one) => one.classList.contains("knowledge-facts__row--expired"));
    expect(expired).toHaveLength(1);
    expect(expired[0]).toHaveTextContent(RELEARNED_NOTE);
    expect(screen.getByText("3 awaiting review")).toBeInTheDocument();
    expect(announced()).toHaveTextContent("Re-learned as a new proposal: Zephyr 4.0 needs CONFIG_LEGACY_TIMER");
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe("a viewer", () => {
  it("sees every action in its place, inert with the reason, and no press reaches the service", () => {
    draw({ mayDecide: false });

    const actions = screen.getAllByRole("button").filter((one) => /^(Confirm|Reject|Re-learn):/.test(one.getAttribute("aria-label") ?? ""));

    expect(actions).toHaveLength(5);
    for (const button of actions) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("title", VIEWER_REASON);
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: ADD_FACT_LABEL })).toHaveAttribute("aria-disabled", "true");
    expect(decideFact).not.toHaveBeenCalled();
  });
});

describe("the states", () => {
  it("says nothing is learned yet, and how a fact arrives, with the add affordance", () => {
    draw({ facts: { ok: true, value: seededFacts([]) } });

    expect(screen.getByText(NO_FACTS_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/awaiting review/)).toBeNull();
    expect(screen.getByRole("button", { name: ADD_FACT_LABEL })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText(FACTS_FOOT)).toBeInTheDocument();
  });

  it("says the facts could not be read, with the reason", () => {
    draw({ facts: { ok: false, reason: "The service failed." } });

    expect(screen.getByText(FACTS_UNREAD_TITLE)).toBeInTheDocument();
    expect(screen.getByText("The service failed.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("the keyboard", () => {
  it("reaches every action, link and control in the tab order", () => {
    draw();

    const controls = [...screen.getAllByRole("button"), ...screen.getAllByRole("link")];

    expect(controls.length).toBeGreaterThan(8);
    for (const control of controls) expect(control).not.toHaveAttribute("tabindex", "-1");
  });
});
