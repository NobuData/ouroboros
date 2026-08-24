import Link from "next/link";

import { ModelsFrame } from "@/app/models/models-frame";
import { Button, Card, EmptyState } from "@/app/ui";

import { ImportMenu } from "./import-menu";
import {
  CONNECT_PROVIDER_HREF,
  CONNECT_PROVIDER_LABEL,
  NEW_ALIAS_LABEL,
  REGISTRY_NEXT_NOTE,
  REGISTRY_NEXT_TITLE,
  REGISTRY_SUBLINE,
  REGISTRY_TITLE,
  importState,
  newAliasReason,
  type RegistryReadings,
} from "./view";

import "./registry.css";

/**
 * The `/models/registry` frame ([#591](https://github.com/NobuData/ouroboros/issues/591)) —
 * `docs/mockups/21-model-registry.html`'s page head and tab set as a working page.
 *
 * It renders **inside the app shell** and inside the Models section's own frame
 * (`app/models/models-frame.tsx`), so it starts at its page head, contributes no chrome of its
 * own, and draws the same tab row `/models` and `/models/providers` draw with the underline
 * moved. The mockup's `.topbar`/`.nav` markup is superseded: this surface is reached from the
 * sidebar's **Models** entry — which stays lit here because the route is under `/models`
 * (`app/paths.ts`) — and from the Model registry tab on either sibling page.
 *
 * It is a component rather than markup written in the route, for the reason every screen in
 * this module is: everything it draws can be rendered and asserted on without Next.js's
 * routing around it. The route gates and reads (`app/(app)/models/registry/page.tsx`,
 * `app/registry/data.ts`), a pure module decides (`app/registry/view.ts`), and this draws.
 *
 * ### The head is the product's argument, and it is verbatim
 *
 * *"Every model gets a name. Every route points at the name."* is not a heading, it is the
 * sentence the rest of the page defends — and the subline under it is why anyone should care:
 * an alias is an indirection, so the provider behind a name can be replaced without touching a
 * route or a workflow. Both are held as constants in `view.ts` and compared against the mockup
 * by `__tests__/registry/view.test.ts`, because copy that can be paraphrased in implementation
 * is copy that quietly weakens.
 *
 * ### The two actions, and the state the mockup does not draw
 *
 * **Import from provider ▾** is a real dropdown over the workspace's connected providers
 * (`app/registry/import-menu.tsx`). The mockup shows it with a caret and nothing else; a fresh
 * workspace has connected nothing, so the state that matters most is the one the drawing
 * omits — the control inert, saying so, and offering the one link that fixes it. That link is
 * rendered **only** for the blocked state a reader can act on: a member offered *"connect a
 * provider →"* would be pointed at a page that would also refuse them.
 *
 * **+ New alias** is the primary action and leads to CI.4's create dialog
 * ([#594](https://github.com/NobuData/ouroboros/issues/594)), which does not exist yet — so it
 * is inert through `Button`'s `reason` and says which issue brings it, rather than sitting
 * dead or being left off a head whose whole arrangement is one action beside the other.
 *
 * Both are also inert for a member or a viewer. The full gating pass is CI.6
 * ([#596](https://github.com/NobuData/ouroboros/issues/596)); what this ticket owes is that the
 * two controls it builds are already honest about who may press them.
 *
 * ### What this page does not pretend
 *
 * Below the tab set is where the eight-column allowed-models table goes, and it is CI.2's
 * ([#592](https://github.com/NobuData/ouroboros/issues/592)). The space carries an empty state
 * naming the issues that fill it rather than a table of invented aliases — § 3.5 applied to a
 * frame: a surface that is not ready is **labelled**, never dead, and never a mock-up of
 * itself.
 *
 * A Server Component. Its one interactive piece is the import menu, which declares its own
 * client boundary.
 */

/** What the screen needs to draw itself. */
export interface RegistryScreenProps {
  /** Everything the reader was able to read, and why not for the rest. */
  readonly readings: RegistryReadings;
  /**
   * Whether this reader's role may create aliases — `app/api/membership.ts`'s
   * `mayAdminister`, decided at the gate.
   *
   * A boolean rather than the role itself, because the page asks one question of it and a
   * screen holding a role would be a second place deciding what a role may do.
   */
  readonly mayAdminister: boolean;
}

/**
 * The registry screen.
 *
 * @param props See {@link RegistryScreenProps}.
 * @returns The screen.
 */
export function RegistryScreen({ readings, mayAdminister }: RegistryScreenProps) {
  const importing = importState(readings.providers, mayAdminister);

  return (
    <ModelsFrame
      active="registry"
      // No tone: mockup 21 draws the active tab in the accent, which is the primitive's base
      // hue and what `PageSubnav` renders when told nothing. Mockup 06's violet is the one
      // deliberate divergence and stays on that page alone.
      title={REGISTRY_TITLE}
      subline={REGISTRY_SUBLINE}
      actions={
        <>
          <ImportMenu state={importing} />
          <Button reason={newAliasReason(mayAdminister)} tone="primary">
            {NEW_ALIAS_LABEL}
          </Button>

          {/*
            The one blocked state with something to do about it. Rendered inside the action
            column so it sits under the buttons it explains, and as a `Link` rather than a
            `Button` because it navigates — the distinction `app/ui/button.tsx` draws between
            a control that acts and one that goes somewhere.
          */}
          {importing.kind === "blocked" && importing.connect ? (
            <p className="registry__hint">
              <Link className="registry__hint-link" href={CONNECT_PROVIDER_HREF}>
                {CONNECT_PROVIDER_LABEL}
              </Link>
            </p>
          ) : null}
        </>
      }
    >
      {/*
        The rest of the mockup, named rather than mocked. A placeholder table of invented
        aliases would be the one dishonest thing on a page built to be honest — and would be
        indistinguishable, in a screenshot, from the real one CI.2 ships.
      */}
      <Card className="models__next" fill>
        <EmptyState fill note={REGISTRY_NEXT_NOTE} title={REGISTRY_NEXT_TITLE} />
      </Card>
    </ModelsFrame>
  );
}
