import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALL_REPOS_OPTION,
  type BacklogFilter,
  CLEAR_ALL_LABEL,
  DEFAULT_FILTER,
  FACETS_UNREAD,
  FILTER_BAR_LABEL,
  LABELS_LABEL,
  NO_LABELS_IN_SCOPE,
  REPO_LABEL,
  REPOS_UNREAD,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LABEL,
  SEARCH_PLACEHOLDER,
  SORT_LABEL,
  SORT_OPTIONS,
  STATE_LABEL,
  STATE_OPTIONS,
  UNLISTED_REPO_OPTION,
  UPDATING_VIEW,
  filterHref,
} from "@/app/issues/filter";
import { requestClearFilters } from "@/app/issues/clear-filters";

import { ATLAS, FACETED, HELIOS, LISTED, SEEDED_FACETS } from "../helpers/issues";
import { TENANT_ID } from "../helpers/login";
import { maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The filter bar as it is drawn and as it writes (#116).
 *
 * What the address *means* is `filter.test.ts`'s, as functions. What is here is what only a render
 * can show: that the bar draws the address it was given — including a repository or a label the
 * lists do not carry — that every press writes the next address and nothing else, that the search
 * box waits and every other control does not, that **Clear all** comes and goes with the filter,
 * that the header's focus repository and the select move together in both directions, that every
 * control is a native one the keyboard reaches, and that the two palettes produce one markup.
 *
 * The router is the one seam replaced: `replace` is recorded, and nothing re-renders from it —
 * the route would, with the address the bar wrote — so a case that needs the address to have moved
 * re-renders with the filter it would have carried.
 */

/** What the bar wrote to the address, per case. */
const replace = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

const { FilterBar } = await import("@/app/issues/filter-bar");
const { focusRepoIn, focusRepoState, resetFocusRepos, setFocusRepo } = await import(
  "@/app/shell/focus-repo"
);

/** The bar's props, with the seeded readings unless a case says otherwise. */
type Props = Parameters<typeof FilterBar>[0];

/**
 * The bar for an address.
 *
 * @param over The props this case is about.
 * @returns The element to render.
 */
function bar(over: Partial<Props> = {}) {
  return (
    <FilterBar
      facets={FACETED}
      filter={DEFAULT_FILTER}
      organizationId={TENANT_ID}
      repos={LISTED}
      {...over}
    />
  );
}

/** The repository select. */
function repoSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: REPO_LABEL });
}

/** The search box. */
function searchBox(): HTMLInputElement {
  return screen.getByRole("searchbox", { name: SEARCH_LABEL });
}

/** One chip, by its label. */
function chip(label: string): HTMLButtonElement {
  return within(screen.getByRole("group", { name: LABELS_LABEL })).getByRole("button", {
    name: label,
  });
}

/** The header's focus repository, as the store holds it for the seeded workspace. */
function focus() {
  return focusRepoIn(focusRepoState(), TENANT_ID);
}

/** Choose a value in a select. */
function choose(select: HTMLSelectElement, value: string): void {
  fireEvent.change(select, { target: { value } });
}

/** Type into the search box. */
function type(value: string): void {
  fireEvent.change(searchBox(), { target: { value } });
}

/** Where the bar last navigated to, and how. */
function wrote(): [string, { scroll: boolean }] {
  expect(replace).toHaveBeenCalledOnce();
  return replace.mock.calls[0] as [string, { scroll: boolean }];
}

/** A filtered address, for the cases about leaving one. */
const FILTERED: BacklogFilter = {
  repo: HELIOS.id,
  labels: ["bug"],
  state: "closed",
  sort: "updated",
  q: "watchdog",
};

beforeEach(() => {
  replace.mockReset();
  window.localStorage.clear();
  resetFocusRepos();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  resetFocusRepos();
});

describe("drawing the address", () => {
  it("is a named region holding the mockup's five controls, in its order", () => {
    render(bar());

    const region = screen.getByRole("region", { name: FILTER_BAR_LABEL });
    const controls = [...region.querySelectorAll("select, [role=group], input")].map(
      (control) => control.getAttribute("aria-label"),
    );

    expect(controls).toEqual([REPO_LABEL, LABELS_LABEL, STATE_LABEL, SORT_LABEL, SEARCH_LABEL]);
    expect(searchBox()).toHaveAttribute("placeholder", SEARCH_PLACEHOLDER);
  });

  it("draws the default view: every repository, no chip on, open, by effort, nothing searched", () => {
    render(bar());

    expect(repoSelect()).toHaveValue("");
    expect(repoSelect()).toHaveDisplayValue(ALL_REPOS_OPTION);
    expect(screen.queryAllByRole("button", { pressed: true })).toEqual([]);
    expect(screen.getByRole("combobox", { name: STATE_LABEL })).toHaveValue("open");
    expect(screen.getByRole("combobox", { name: SORT_LABEL })).toHaveValue("effort");
    expect(searchBox()).toHaveValue("");
    expect(screen.queryByRole("button", { name: CLEAR_ALL_LABEL })).toBeNull();
  });

  it("offers the enabled repositories by name, after All repos", () => {
    render(bar());

    expect(
      within(repoSelect())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([ALL_REPOS_OPTION, HELIOS.name, ATLAS.name]);
  });

  it("offers the state and sort options in the ticket's order, with the ticket's names", () => {
    render(bar());

    expect(
      within(screen.getByRole("combobox", { name: STATE_LABEL }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(STATE_OPTIONS.map((option) => option.label));
    expect(
      within(screen.getByRole("combobox", { name: SORT_LABEL }))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(SORT_OPTIONS.map((option) => option.label));
  });

  it("draws a filtered address on every control, with Clear all after them", () => {
    render(bar({ filter: FILTERED }));

    expect(repoSelect()).toHaveValue(HELIOS.id);
    expect(chip("bug")).toHaveAttribute("aria-pressed", "true");
    expect(chip("enhancement")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("combobox", { name: STATE_LABEL })).toHaveValue("closed");
    expect(screen.getByRole("combobox", { name: SORT_LABEL })).toHaveValue("updated");
    expect(searchBox()).toHaveValue("watchdog");
    expect(screen.getByRole("button", { name: CLEAR_ALL_LABEL })).toHaveClass("ou-btn--ghost");
  });

  it("draws the chip set from the facets, as tags, with the mockup's ✓ on a pressed one", () => {
    render(bar({ filter: { ...DEFAULT_FILTER, labels: ["bug"] } }));

    const chips = within(screen.getByRole("group", { name: LABELS_LABEL })).getAllByRole("button");

    expect(chips.map((one) => one.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    expect(chips.map((one) => one.textContent)).toEqual([
      "bug ✓",
      "enhancement",
      "good-first-issue",
      "tech-debt",
    ]);
    // The mark is decoration: the name is the label, and the state is the attribute.
    expect(chip("bug")).toHaveAccessibleName("bug");
    expect(chip("bug")).toHaveClass("ou-tag");
  });

  it("keeps a label the address names and the facets do not, pressed and last", () => {
    render(bar({ filter: { ...DEFAULT_FILTER, labels: ["retired"] } }));

    const chips = within(screen.getByRole("group", { name: LABELS_LABEL })).getAllByRole("button");

    expect(chips.map((one) => one.getAttribute("aria-pressed"))).toEqual([
      ...SEEDED_FACETS.map(() => "false"),
      "true",
    ]);
    expect(chips.at(-1)).toHaveAccessibleName("retired");
  });

  it("keeps a repository the address names and the list does not, as a selected option", () => {
    render(bar({ filter: { ...DEFAULT_FILTER, repo: "5eed0006-0000-4000-8000-00000000dead" } }));

    expect(repoSelect()).toHaveValue("5eed0006-0000-4000-8000-00000000dead");
    expect(repoSelect()).toHaveDisplayValue(UNLISTED_REPO_OPTION);
  });

  it("says when nothing in scope carries a label", () => {
    render(bar({ facets: { ok: true, value: [] } }));

    expect(screen.getByRole("group", { name: LABELS_LABEL })).toHaveTextContent(
      NO_LABELS_IN_SCOPE,
    );
  });

  it("says why the chip set could not be read, and still draws the address's chips", () => {
    render(
      bar({
        facets: { ok: false, reason: "Not now." },
        filter: { ...DEFAULT_FILTER, labels: ["bug"] },
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent(`${FACETS_UNREAD} Not now.`);
    expect(chip("bug")).toHaveAttribute("aria-pressed", "true");
  });

  it("says why the repositories could not be listed, and still offers All repos", () => {
    render(bar({ repos: { ok: false, reason: "Not yours." } }));

    expect(screen.getByRole("status")).toHaveTextContent(`${REPOS_UNREAD} Not yours.`);
    expect(
      within(repoSelect())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([ALL_REPOS_OPTION]);
  });
});

describe("writing the address", () => {
  it("turns a chip on by replacing the address, without scrolling the pane", () => {
    render(bar());

    fireEvent.click(chip("bug"));

    expect(wrote()).toEqual(["/issues?labels=bug", { scroll: false }]);
  });

  it("turns a chip off the same way, and ANDs a second one on", () => {
    const { rerender } = render(bar({ filter: { ...DEFAULT_FILTER, labels: ["bug"] } }));

    fireEvent.click(chip("tech-debt"));
    expect(replace).toHaveBeenLastCalledWith("/issues?labels=bug,tech-debt", { scroll: false });

    rerender(bar({ filter: { ...DEFAULT_FILTER, labels: ["bug", "tech-debt"] } }));
    fireEvent.click(chip("bug"));
    expect(replace).toHaveBeenLastCalledWith("/issues?labels=tech-debt", { scroll: false });
  });

  it("writes the state and the sort", () => {
    render(bar());

    choose(screen.getByRole("combobox", { name: STATE_LABEL }), "closed");
    expect(replace).toHaveBeenLastCalledWith("/issues?state=closed", { scroll: false });

    choose(screen.getByRole("combobox", { name: SORT_LABEL }), "number");
    expect(replace).toHaveBeenLastCalledWith("/issues?sort=number", { scroll: false });
  });

  it("writes a repository, and publishes it to the header's focus by name", () => {
    render(bar());

    choose(repoSelect(), ATLAS.id);

    expect(wrote()).toEqual([`/issues?repo=${ATLAS.id}`, { scroll: false }]);
    expect(focus()).toEqual({ id: ATLAS.id, name: ATLAS.name });
  });

  it("writes All repos as the absence of one, and clears the header's focus", () => {
    setFocusRepo(TENANT_ID, { id: HELIOS.id, name: HELIOS.name });
    render(bar({ filter: { ...DEFAULT_FILTER, repo: HELIOS.id } }));

    choose(repoSelect(), "");

    expect(wrote()).toEqual(["/issues", { scroll: false }]);
    expect(focus()).toBeNull();
  });

  it("keeps the rest of the address when one control moves", () => {
    render(bar({ filter: FILTERED }));

    choose(screen.getByRole("combobox", { name: STATE_LABEL }), "all");

    expect(wrote()[0]).toBe(filterHref({ ...FILTERED, state: "all" }));
  });
});

describe("the search box", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("waits for the typing to stop, then writes the search once", () => {
    render(bar());

    type("w");
    type("wa");
    type("wat");
    expect(replace).not.toHaveBeenCalled();
    expect(searchBox()).toHaveValue("wat");

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(wrote()).toEqual(["/issues?q=wat", { scroll: false }]);
  });

  it("writes the search trimmed, and does not write again for trailing whitespace", () => {
    const { rerender } = render(bar());

    type(" wat ");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(replace).toHaveBeenLastCalledWith("/issues?q=wat", { scroll: false });

    rerender(bar({ filter: { ...DEFAULT_FILTER, q: "wat" } }));
    type("wat  ");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("is flushed by any other control, so a chip pressed mid-word asks for the word too", () => {
    render(bar());

    type("wat");
    fireEvent.click(chip("bug"));

    expect(wrote()).toEqual(["/issues?labels=bug&q=wat", { scroll: false }]);

    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("keeps what is typed when the address comes back with what the bar itself wrote", () => {
    const { rerender } = render(bar());

    type("wat");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    type("watch");

    // The route re-renders with the search the bar committed a moment ago.
    rerender(bar({ filter: { ...DEFAULT_FILTER, q: "wat" } }));

    expect(searchBox()).toHaveValue("watch");
  });

  it("adopts the address's search when it moved by another hand, and drops the pending write", () => {
    const { rerender } = render(bar({ filter: { ...DEFAULT_FILTER, q: "wat" } }));

    type("watch");

    // Back, or a pasted link: the address says something the bar never wrote.
    rerender(bar({ filter: { ...DEFAULT_FILTER, q: "bus" } }));

    expect(searchBox()).toHaveValue("bus");
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows Clear all as soon as something is typed, before the address moves", () => {
    render(bar());

    type("w");

    expect(screen.getByRole("button", { name: CLEAR_ALL_LABEL })).toBeInTheDocument();
  });
});

describe("Clear all", () => {
  it("goes back to the bare address, empties the box, and clears the header's focus", () => {
    setFocusRepo(TENANT_ID, { id: HELIOS.id, name: HELIOS.name });
    render(bar({ filter: FILTERED }));

    fireEvent.click(screen.getByRole("button", { name: CLEAR_ALL_LABEL }));

    expect(wrote()).toEqual(["/issues", { scroll: false }]);
    expect(searchBox()).toHaveValue("");
    expect(focus()).toBeNull();
  });

  it("is drawn for a sort alone, since that is not the default view either", () => {
    render(bar({ filter: { ...DEFAULT_FILTER, sort: "number" } }));

    expect(screen.getByRole("button", { name: CLEAR_ALL_LABEL })).toBeInTheDocument();
  });

  it("is what the table's Clear filters asks for, through the signal, move for move (#120)", () => {
    setFocusRepo(TENANT_ID, { id: HELIOS.id, name: HELIOS.name });
    render(bar({ filter: FILTERED }));

    act(() => {
      requestClearFilters();
    });

    expect(wrote()).toEqual(["/issues", { scroll: false }]);
    expect(searchBox()).toHaveValue("");
    expect(focus()).toBeNull();
  });

  it("stops listening for the signal once unmounted", () => {
    const { unmount } = render(bar({ filter: FILTERED }));
    unmount();

    act(() => {
      requestClearFilters();
    });

    expect(replace).not.toHaveBeenCalled();
  });
});

describe("the address moving (#120)", () => {
  it("is not reported at rest: the region is not busy and carries no pending line", () => {
    render(bar());

    expect(screen.getByRole("region", { name: FILTER_BAR_LABEL })).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText(UPDATING_VIEW)).toBeNull();
  });

  it("navigates inside a transition, so the route's own pending state is the bar's to report", () => {
    // The router is a stub that resolves nothing, so the transition settles at once here; what
    // is asserted is that the navigation is made — the pending line is the route's to show.
    render(bar());

    fireEvent.click(chip("bug"));

    expect(wrote()[0]).toBe("/issues?labels=bug");
    expect(screen.queryByText(UPDATING_VIEW)).toBeNull();
  });
});

describe("the header's focus repository", () => {
  it("is published from an address that names a repository, so a pasted link wins", () => {
    setFocusRepo(TENANT_ID, { id: ATLAS.id, name: ATLAS.name });

    render(bar({ filter: { ...DEFAULT_FILTER, repo: HELIOS.id } }));

    expect(focus()).toEqual({ id: HELIOS.id, name: HELIOS.name });
    expect(replace).not.toHaveBeenCalled();
  });

  it("is adopted into a bare address, so the sidebar's Issues entry opens the focused backlog", () => {
    setFocusRepo(TENANT_ID, { id: HELIOS.id, name: HELIOS.name });

    render(bar());

    expect(wrote()).toEqual([`/issues?repo=${HELIOS.id}`, { scroll: false }]);
    expect(focus()).toEqual({ id: HELIOS.id, name: HELIOS.name });
  });

  it("is adopted even when the list could not be read, as the header trusts it", () => {
    setFocusRepo(TENANT_ID, { id: HELIOS.id, name: HELIOS.name });

    render(bar({ repos: { ok: false, reason: "Not yours." } }));

    expect(wrote()[0]).toBe(`/issues?repo=${HELIOS.id}`);
  });

  it("is dropped when the workspace no longer lists it, as the header's own menu drops it", () => {
    setFocusRepo(TENANT_ID, { id: "5eed0006-0000-4000-8000-00000000dead", name: "retired" });

    render(bar());

    expect(focus()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("is left alone by an address naming a repository the list cannot name", () => {
    setFocusRepo(TENANT_ID, { id: ATLAS.id, name: ATLAS.name });

    render(bar({ filter: { ...DEFAULT_FILTER, repo: "5eed0006-0000-4000-8000-00000000dead" } }));

    expect(focus()).toEqual({ id: ATLAS.id, name: ATLAS.name });
    expect(replace).not.toHaveBeenCalled();
  });

  it("is followed into the address when the header's chip moves it", () => {
    setFocusRepo(TENANT_ID, { id: HELIOS.id, name: HELIOS.name });
    render(bar({ filter: FILTERED }));
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      setFocusRepo(TENANT_ID, { id: ATLAS.id, name: ATLAS.name });
    });
    expect(replace).toHaveBeenLastCalledWith(filterHref({ ...FILTERED, repo: ATLAS.id }), {
      scroll: false,
    });

    act(() => {
      setFocusRepo(TENANT_ID, null);
    });
    expect(replace).toHaveBeenLastCalledWith(filterHref({ ...FILTERED, repo: null }), {
      scroll: false,
    });
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("does not follow a move it made itself", () => {
    render(bar());

    choose(repoSelect(), HELIOS.id);

    expect(replace).toHaveBeenCalledOnce();
  });
});

describe("the keyboard", () => {
  it("reaches every control, because each is a native one in the tab order", () => {
    render(bar({ filter: FILTERED }));

    const region = screen.getByRole("region", { name: FILTER_BAR_LABEL });
    const controls = [...region.querySelectorAll("select, button, input")];

    expect(controls).toHaveLength(3 + SEEDED_FACETS.length + 1 + 1);
    for (const control of controls) {
      expect(control).not.toHaveAttribute("tabindex");
      expect(control).not.toBeDisabled();
      expect(control).not.toHaveAttribute("aria-disabled");
    }
  });

  it("toggles a chip from the keyboard, since a chip is a button", () => {
    render(bar());

    expect(chip("bug").tagName).toBe("BUTTON");
    expect(chip("bug")).toHaveAttribute("type", "button");
    chip("bug").focus();
    fireEvent.click(document.activeElement as HTMLElement);

    expect(wrote()[0]).toBe("/issues?labels=bug");
  });
});

describe("both palettes", () => {
  it("render the same markup, so the chip-on treatment is the stylesheet's alone", () => {
    const [light, dark] = renderInBothPalettes(bar({ filter: FILTERED }));

    expect(maskIds(light!)).toBe(maskIds(dark!));
    expect(light).toContain('aria-pressed="true"');
  });
});
