import { READING_TESTS } from "./view";

import "./tests.css";

/**
 * The test-results page while its first read is in flight
 * ([#335](https://github.com/NobuData/ouroboros/issues/335)). A sentence rather than a skeleton:
 * the page's running, empty and error states are AU.8's
 * ([#342](https://github.com/NobuData/ouroboros/issues/342)).
 *
 * @returns The placeholder.
 */
export function TestsLoading() {
  return (
    <main aria-busy="true" className="tests">
      <p className="tests__empty" role="status">
        {READING_TESTS}
      </p>
    </main>
  );
}
