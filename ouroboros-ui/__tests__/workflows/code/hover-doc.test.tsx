import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CodeSymbol } from "@/app/api/workflows";
import { hoverCardElement } from "@/app/workflows/code/hover";
import { HoverDocCard } from "@/app/workflows/code/hover-doc";

import { CODE_SYMBOLS } from "../../helpers/code-symbols";
import { renderInBothPalettes } from "../../helpers/palettes";

/**
 * The hover-doc card (W.1, [#177](https://github.com/NobuData/ouroboros/issues/177)) — mockup
 * 05's Types card as a component, for the panel V.5 (#173) mounts it in.
 *
 * jsdom applies no stylesheet, so "both themes" is proven the way `__tests__/helpers/palettes.tsx`
 * describes: identical markup under both palettes here, and every hue a token defined in both
 * palettes in `code-styles.test.ts`.
 */

/**
 * A symbol from the golden table.
 *
 * @param name The symbol.
 * @returns Its card.
 */
function symbol(name: string): CodeSymbol {
  const found = CODE_SYMBOLS.symbols.find((entry) => entry.symbol === name);
  if (found === undefined) throw new Error(`The golden table does not describe ${name}.`);
  return found;
}

describe("the card", () => {
  it("prints the mockup's signature and doc line", () => {
    const { container } = render(<HoverDocCard symbol={symbol("route.task")} />);

    expect(container.textContent).toBe(
      "route.task(name: TaskKind): ModelRoute" +
        "Resolves the model assigned to a task kind in Model Routing.",
    );
    expect(container.querySelector(".code-hover-doc__name")?.textContent).toBe("route.task");
    expect(
      [...container.querySelectorAll(".code-hover-doc__type")].map((node) => node.textContent),
    ).toEqual(["TaskKind", "ModelRoute"]);
    expect(container.querySelector(".code-hover-doc__doc")?.textContent).toBe(
      "Resolves the model assigned to a task kind in Model Routing.",
    );
  });

  it("renders the same markup the editor's hover tooltip builds", () => {
    const card = symbol("route.task");
    const { container } = render(<HoverDocCard symbol={card} />);

    expect(container.innerHTML).toBe(hoverCardElement(card, document).outerHTML);
  });

  it("draws no doc line for a symbol the schema does not describe", () => {
    const { container } = render(<HoverDocCard symbol={symbol("stage.llm.retries")} />);

    expect(container.querySelector(".code-hover-doc__doc")).toBeNull();
    expect(container.textContent).toBe("retries: integer");
  });

  it("adds a placement class beside its own", () => {
    const { container } = render(
      <HoverDocCard className="types-panel__card" symbol={symbol("route.task")} />,
    );

    expect(container.firstElementChild?.className).toBe("code-hover-doc types-panel__card");
  });
});

describe("both themes", () => {
  it.each(["route.task", "stage.llm.retries", "predicate.checks.allPassed"])(
    "renders %s identically under both palettes",
    (name) => {
      const [light, dark] = renderInBothPalettes(<HoverDocCard symbol={symbol(name)} />);

      expect(light.length).toBeGreaterThan(0);
      expect(dark).toBe(light);
    },
  );
});
