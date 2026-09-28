import { READING_PR } from "./view";

import "./prs.css";

/**
 * The PR verification page while its first read is in flight
 * ([#363](https://github.com/NobuData/ouroboros/issues/363)). A sentence rather than a skeleton:
 * the page's merged, blocked and conflict states are AY.8's
 * ([#370](https://github.com/NobuData/ouroboros/issues/370)).
 *
 * @returns The placeholder.
 */
export function PrLoading() {
  return (
    <main aria-busy="true" className="prv">
      <p className="prv__empty" role="status">
        {READING_PR}
      </p>
    </main>
  );
}
