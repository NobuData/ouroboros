import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CHANGED, SAVING, savedRoutes } from "@/app/models/chain";
import {
  ALLOW_LOCAL_LABEL,
  COST_MALFORMED,
  COST_ZERO,
  FLOOR_HOP_LABEL,
  MAX_COST_HINT,
  MAX_COST_LABEL,
  OPEN_REGISTRY,
  POLICY_READ_ONLY,
  REGISTRY_NOTE,
  floorSentence,
} from "@/app/models/inspector";
import { REGISTRY_PATH } from "@/app/paths";

import { seededTaskKinds } from "../helpers/models";
import { PALETTES, maskIds, renderInBothPalettes } from "../helpers/palettes";

/**
 * The inspector's policy controls as they are drawn (#203) — mockup 06's two switches, the
 * cost field and the footnote, under the chain.
 *
 * What each edit *does* to a draft is `chain.test.ts`'s, what the parser makes of typed text
 * is `inspector.test.ts`'s, and what the editor holds is `route-editor.test.tsx`'s. What is
 * here is what only a render can show: that the seeded route reproduces the mockup's two
 * toggle states and its `$2.50`, that every control edits the batch and none of them saves,
 * that a malformed cap is refused inline at the field, that the floor is the mockup's sentence
 * with a number a reader can move, and that a member sees the policy inert with its reason.
 */

const saveRoutes = vi.fn();

vi.mock("@/app/models/route-actions", () => ({ saveRoutes: (routes: unknown) => saveRoutes(routes) }));
vi.mock("@/app/models/rule-actions", () => ({
  readRuleTargets: vi.fn().mockResolvedValue({ ok: true, aliases: [] }),
  setRuleEnabled: vi.fn(),
  addRule: vi.fn(),
  removeRule: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { RouteEditorProvider, useRouteEditor } = await import("@/app/models/route-editor");
const { RoutePolicy } = await import("@/app/models/route-policy");

/** The seeded routes, as the screen hands them to the provider. */
const ROUTES = savedRoutes(seededTaskKinds());

/** The editor as the surfaces beside the controls see it — the bar's count, a discard, a save. */
let editor: ReturnType<typeof useRouteEditor>;

/**
 * A surface reading the same editor, so a test can see the count and press what the bar
 * presses. It hands the editor to the test through a prop rather than assigning it, because a
 * component may not write a variable outside itself.
 *
 * @param props.report Where the editor goes, each render.
 * @returns The count, and the mark a changed route wears.
 */
function Probe({ report }: Readonly<{ report: (current: ReturnType<typeof useRouteEditor>) => void }>) {
  const current = useRouteEditor();
  report(current);

  return (
    <p data-testid="pending">
      {current.pending} {current.edit("implement") === null ? "" : CHANGED}
    </p>
  );
}

/**
 * The controls for one route, under an editor.
 *
 * @param props.kind Which route. Defaults to the mockup's `implement`.
 * @param props.editable Whether the reader may edit. Defaults to yes.
 * @returns The Testing Library render result.
 */
function policy({ kind = "implement", editable = true }: { kind?: string; editable?: boolean } = {}) {
  return render(
    <RouteEditorProvider editable={editable} routes={ROUTES}>
      <RoutePolicy kind={kind} />
      <Probe
        report={(current) => {
          editor = current;
        }}
      />
    </RouteEditorProvider>,
  );
}

/** The two switches. */
function allowLocal(): HTMLElement {
  return screen.getByRole("switch", { name: ALLOW_LOCAL_LABEL });
}

function floor(hop = 2): HTMLElement {
  return screen.getByRole("switch", { name: floorSentence(hop) });
}

/** The floor's visible sentence — the label beside its switch, not the switch's hidden name. */
function sentence(): HTMLElement {
  const labels = document.querySelectorAll<HTMLElement>(".models-policy__label");
  const floor = labels[1];
  if (floor === undefined) throw new Error("the floor row is the second");
  return floor;
}

/** The cost field. */
function cost(): HTMLInputElement {
  return screen.getByLabelText(MAX_COST_LABEL);
}

/** How many routes the editor counts as changed. */
function pending(): string {
  return screen.getByTestId("pending").textContent?.trim() ?? "";
}

beforeEach(() => {
  saveRoutes.mockReset().mockResolvedValue({ ok: true, revisionId: "rev-1" });
});

describe("the seeded implement route, as the mockup draws it", () => {
  it("reproduces both toggle states, the cap and the footnote", () => {
    policy();

    expect(allowLocal()).toHaveAttribute("aria-checked", "true");
    expect(floor()).toHaveAttribute("aria-checked", "false");
    expect(sentence()).toHaveTextContent("Fail run instead of degrading below fallback 2");
    expect(cost()).toHaveValue("$2.50");
    expect(screen.getByText(REGISTRY_NOTE, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: OPEN_REGISTRY })).toHaveAttribute("href", REGISTRY_PATH);
  });

  it("draws every control live for a role that may edit, with the field's hint", () => {
    policy();

    expect(allowLocal()).not.toHaveAttribute("aria-disabled");
    expect(floor()).not.toHaveAttribute("aria-disabled");
    expect(cost()).toBeEnabled();
    expect(cost()).toHaveAccessibleDescription(MAX_COST_HINT);
    expect(screen.queryByText(POLICY_READ_ONLY)).not.toBeInTheDocument();
  });

  it("draws nothing for a kind with no route — the chain has already said so", () => {
    policy({ kind: "deploy" });

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(MAX_COST_LABEL)).not.toBeInTheDocument();
  });
});

describe("policy edits join the dirty batch, and nothing saves on change", () => {
  it("flips the local-fallback switch onto the draft, counted as one changed route", () => {
    policy();

    fireEvent.click(allowLocal());

    expect(allowLocal()).toHaveAttribute("aria-checked", "false");
    expect(pending()).toBe(`1 ${CHANGED}`);
    expect(saveRoutes).not.toHaveBeenCalled();
  });

  it("flips it back, and the route is no longer a change", () => {
    policy();

    fireEvent.click(allowLocal());
    fireEvent.click(allowLocal());

    expect(pending()).toBe("0");
  });

  it("commits with Save routes, carrying the chain it did not touch", async () => {
    policy();

    fireEvent.click(allowLocal());
    await act(async () => {
      editor.save();
    });

    expect(saveRoutes).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({
        taskKind: "implement",
        allowLocalFallback: false,
        floorHopIndex: null,
        maxCostCentsPerRun: 250,
        hops: [
          { alias: "coder-max", note: null },
          { alias: "coder-fallback", note: "Fallback on 5xx / timeouts" },
          { alias: "local-docs", note: "Offline mode — keeps the loop turning without a network" },
        ],
      }),
    ]);
  });

  it("is restored by Discard — the switches, the floor and the field alike", () => {
    policy();

    fireEvent.click(allowLocal());
    fireEvent.click(floor());
    fireEvent.change(cost(), { target: { value: "3" } });
    expect(pending()).toBe(`1 ${CHANGED}`);

    act(() => {
      editor.discard();
    });

    expect(allowLocal()).toHaveAttribute("aria-checked", "true");
    expect(floor()).toHaveAttribute("aria-checked", "false");
    expect(cost()).toHaveValue("$2.50");
    expect(pending()).toBe("0");
  });
});

describe("the floor, as the mockup's sentence", () => {
  it("turns on one above the last resort, and the number becomes a select over the chain", () => {
    policy();

    fireEvent.click(floor());

    expect(floor()).toHaveAttribute("aria-checked", "true");
    expect(editor.draft("implement")?.floorHopIndex).toBe(2);

    const hop = screen.getByRole("combobox", { name: FLOOR_HOP_LABEL });

    expect(hop).toHaveValue("2");
    expect([...hop.querySelectorAll("option")].map((option) => option.value)).toEqual(["1", "2", "3"]);
    expect(sentence()).toHaveTextContent(/^Fail run instead of degrading below fallback/);
  });

  it("moves the floor from inside the sentence, and the switch's name follows it", () => {
    policy();

    fireEvent.click(floor());
    fireEvent.change(screen.getByRole("combobox", { name: FLOOR_HOP_LABEL }), { target: { value: "1" } });

    expect(editor.draft("implement")?.floorHopIndex).toBe(1);
    expect(floor(1)).toHaveAttribute("aria-checked", "true");
    expect(pending()).toBe(`1 ${CHANGED}`);
  });

  it("turns off to no floor, and the sentence names the floor it would set again", () => {
    policy();

    fireEvent.click(floor());
    fireEvent.click(floor());

    expect(editor.draft("implement")?.floorHopIndex).toBeNull();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(sentence()).toHaveTextContent("Fail run instead of degrading below fallback 2");
    expect(pending()).toBe("0");
  });
});

describe("the cost cap", () => {
  it("parses as typed, lands on the draft in cents, and reprints on blur", () => {
    policy();

    fireEvent.change(cost(), { target: { value: "3" } });
    expect(editor.draft("implement")?.maxCostCentsPerRun).toBe(300);
    expect(cost()).toHaveValue("3");

    fireEvent.change(cost(), { target: { value: "3.25" } });
    expect(editor.draft("implement")?.maxCostCentsPerRun).toBe(325);

    fireEvent.blur(cost());
    expect(cost()).toHaveValue("$3.25");
    expect(pending()).toBe(`1 ${CHANGED}`);
  });

  it("reads an emptied field as no cap", () => {
    policy();

    fireEvent.change(cost(), { target: { value: "" } });

    expect(editor.draft("implement")?.maxCostCentsPerRun).toBeNull();
    expect(pending()).toBe(`1 ${CHANGED}`);
  });

  it("refuses a malformed amount inline, at the field, and keeps the last amount that parsed", () => {
    policy();

    fireEvent.change(cost(), { target: { value: "abc" } });

    expect(cost()).toHaveValue("abc");
    expect(cost()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(COST_MALFORMED);
    expect(cost()).toHaveAccessibleDescription(`${MAX_COST_HINT} ${COST_MALFORMED}`);
    expect(editor.draft("implement")?.maxCostCentsPerRun).toBe(250);
    expect(pending()).toBe("0");
  });

  it("refuses zero with the contract's reason, and leaves a refused entry as typed on blur", () => {
    policy();

    fireEvent.change(cost(), { target: { value: "0" } });
    fireEvent.blur(cost());

    expect(cost()).toHaveValue("0");
    expect(screen.getByRole("alert")).toHaveTextContent(COST_ZERO);
  });

  it("recovers the moment the text parses again", () => {
    policy();

    fireEvent.change(cost(), { target: { value: "abc" } });
    fireEvent.change(cost(), { target: { value: "2.75" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(cost()).not.toHaveAttribute("aria-invalid");
    expect(editor.draft("implement")?.maxCostCentsPerRun).toBe(275);
  });
});

describe("a role that may not edit — the permission-limited state (§ 3.3)", () => {
  it("draws the switches in their real positions, inert with the one reason, and the field disabled", () => {
    policy({ editable: false });

    expect(allowLocal()).toHaveAttribute("aria-checked", "true");
    expect(allowLocal()).toHaveAttribute("aria-disabled", "true");
    expect(allowLocal()).toHaveAttribute("title", POLICY_READ_ONLY);
    expect(floor()).toHaveAttribute("aria-disabled", "true");
    expect(cost()).toBeDisabled();
    expect(cost()).toHaveValue("$2.50");
    expect(cost()).toHaveAccessibleDescription(POLICY_READ_ONLY);
    expect(allowLocal()).toHaveAccessibleDescription(POLICY_READ_ONLY);
  });

  it("changes nothing when pressed anyway", () => {
    policy({ editable: false });

    fireEvent.click(allowLocal());
    fireEvent.click(floor());

    expect(allowLocal()).toHaveAttribute("aria-checked", "true");
    expect(floor()).toHaveAttribute("aria-checked", "false");
    expect(pending()).toBe("0");
  });

  it("still links the registry — reading where aliases resolve is everybody's", () => {
    policy({ editable: false });

    expect(screen.getByRole("link", { name: OPEN_REGISTRY })).toHaveAttribute("href", REGISTRY_PATH);
  });
});

describe("while a save is in flight", () => {
  it("holds every control inert with the saving reason, so an edit cannot race the batch", async () => {
    saveRoutes.mockReturnValue(new Promise(() => {}));
    policy();

    fireEvent.click(allowLocal());
    await act(async () => {
      editor.save();
    });

    expect(allowLocal()).toHaveAttribute("aria-disabled", "true");
    expect(allowLocal()).toHaveAttribute("title", SAVING);
    expect(floor()).toHaveAttribute("aria-disabled", "true");
    expect(cost()).toBeDisabled();
    expect(screen.getByText(SAVING, { selector: ".models-policy__readonly" })).toBeInTheDocument();
  });
});

describe("both palettes", () => {
  it("draws the same markup in both — nothing about the controls is decided from the theme", () => {
    const [light, dark] = renderInBothPalettes(
      <RouteEditorProvider editable routes={ROUTES}>
        <RoutePolicy kind="implement" />
      </RouteEditorProvider>,
    );

    expect(PALETTES).toHaveLength(2);
    expect(maskIds(light)).toBe(maskIds(dark));
  });
});
