import { ModelsFrame } from "@/app/models/models-frame";
import { Card } from "@/app/ui";

import { REGISTRY_SUBLINE, REGISTRY_TITLE } from "./view";

import "./registry.css";

/**
 * What the reader sees while the registry page's reads are in flight (CI.6,
 * [#596](https://github.com/NobuData/ouroboros/issues/596)).
 *
 * `app/(app)/models/registry/loading.tsx` returns this, and the framework wraps the page in a
 * Suspense boundary with it as the fallback, so the shell and the sidebar paint at once and only
 * the page waits — the arrangement `app/models/models-skeleton.tsx` gave the routing page, at
 * this page's own geometry (DASH-I.7, [#86](https://github.com/NobuData/ouroboros/issues/86)).
 *
 * ### The head is the real head
 *
 * The title, the subline and the tab set depend on no read, so they are drawn as themselves; a
 * skeleton would be worse than the thing. Only the two head actions are bars, because both are
 * drawn for a role the skeleton cannot know.
 *
 * ### Below the tabs, the table's own shape
 *
 * The densest table in the product must not jump when it lands, so each row is the table's
 * eight cells on a grid whose tracks mirror `.registry-table__*`'s column rules — the alias
 * pill, the monogram and name, the model id, the params chip at the params column's floor, the
 * health line, the two numeric columns at their shared width, and the switch's track — in rem,
 * so the reservation holds at the 125% font-size preference. The seat row beneath is the three
 * cards skeletoned in place: the inspector's empty well, the why-card's three claims and the
 * chain card's rail. The count is the seeded workspace's eight, which is the height most first
 * paints resolve to.
 *
 * **It says one thing to a screen reader, not a hundred.** The bars carry no text, the region is
 * `aria-hidden`, and the frame's `<main>` is `aria-busy` and labelled once.
 *
 * A Server Component with nothing to decide.
 */

/** What the frame's `<main>` is labelled while it is busy. */
export const LOADING_LABEL = "Loading the model registry";

/** How many rows the table reserves — the seeded workspace's eight aliases. */
export const SKELETON_ALIASES = 8;

/** How many claims the why-card reserves — its three rows. */
export const SKELETON_CLAIMS = 3;

/** How many hops the chain card's rail reserves — route, alias, provider, model, resolution. */
export const SKELETON_HOPS = 5;

/**
 * The skeleton.
 *
 * @returns The frame, with bars where the reads' regions will be.
 */
export function RegistrySkeleton() {
  return (
    <ModelsFrame
      active="registry"
      actions={
        <span aria-hidden className="registry-skeleton__actions">
          <span className="registry-skeleton__action" />
          <span className="registry-skeleton__action" />
        </span>
      }
      busy={LOADING_LABEL}
      subline={REGISTRY_SUBLINE}
      title={REGISTRY_TITLE}
    >
      <div aria-hidden className="registry-skeleton">
        <Card fill>
          <span className="registry-skeleton__head" />
          <div className="registry-skeleton__table">
            <span className="registry-skeleton__thead" />
            {Array.from({ length: SKELETON_ALIASES }, (_, index) => (
              <RowShape key={index} />
            ))}
          </div>
          <span className="registry-skeleton__bar registry-skeleton__bar--caption" />
        </Card>

        <div className="registry-aside">
          {/* The inspector's seat, at the empty state's own height: nothing is selected yet. */}
          <Card fill>
            <span className="registry-skeleton__head" />
            <span className="registry-skeleton__panel" />
          </Card>

          <Card fill>
            <span className="registry-skeleton__head" />
            <div className="registry-skeleton__claims">
              {Array.from({ length: SKELETON_CLAIMS }, (_, index) => (
                <span className="registry-skeleton__claim" key={index}>
                  <span className="registry-skeleton__tick" />
                  <span className="registry-skeleton__bar registry-skeleton__bar--grow" />
                </span>
              ))}
            </div>
          </Card>

          <Card fill>
            <span className="registry-skeleton__head" />
            <div className="registry-skeleton__rail">
              {Array.from({ length: SKELETON_HOPS }, (_, index) => (
                <span className="registry-skeleton__hop" key={index}>
                  <span className="registry-skeleton__tick" />
                  <span className="registry-skeleton__bar registry-skeleton__bar--half" />
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </ModelsFrame>
  );
}

/**
 * One table row: the eight cells, in the order mockup 21 draws them.
 *
 * @returns The row.
 */
function RowShape() {
  return (
    <span className="registry-skeleton__row">
      <span className="registry-skeleton__pill" />
      <span className="registry-skeleton__provider">
        <span className="registry-skeleton__monogram" />
        <span className="registry-skeleton__bar registry-skeleton__bar--grow" />
      </span>
      <span className="registry-skeleton__bar" />
      <span className="registry-skeleton__pill registry-skeleton__pill--short" />
      <span className="registry-skeleton__bar registry-skeleton__bar--half" />
      <span className="registry-skeleton__bar registry-skeleton__bar--num" />
      <span className="registry-skeleton__bar registry-skeleton__bar--num" />
      <span className="registry-skeleton__switch" />
    </span>
  );
}
