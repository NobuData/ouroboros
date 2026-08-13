import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useClientValue } from "@/app/shell/client-value";

/**
 * The shell's hydration-safe read of something only the browser knows
 * ([#643](https://github.com/NobuData/ouroboros/issues/643)).
 *
 * It is three lines over `useSyncExternalStore`, and it is tested because the property it
 * exists for is the one that would go unnoticed if it broke: a helper that returned the
 * *browser's* answer during a server render would produce markup the browser then disagrees
 * with, and React's repair for that is to throw away the tree around it. Nothing in a
 * client-only suite would ever see it — which is why the first case renders on the server.
 */

/** A component that shows whichever answer the hook gave it. */
function Probe() {
  const value = useClientValue(() => "browser", "server");

  return <p>{value}</p>;
}

describe("a value only the browser knows", () => {
  it("is the server's answer when there is no browser", () => {
    // `renderToString` is the real server path, which is the only place the distinction is
    // observable at all.
    expect(renderToString(<Probe />)).toContain("server");
  });

  it("is the browser's answer in the browser", () => {
    render(<Probe />);

    expect(screen.getByText("browser")).toBeInTheDocument();
  });

  it("settles rather than re-rendering forever", () => {
    // `useSyncExternalStore` compares snapshots by identity: a reader that built a new value
    // each call would be a change on every render, and React would loop. Two renders of the
    // same tree agreeing is what "stable" looks like from outside.
    const { rerender } = render(<Probe />);
    rerender(<Probe />);

    expect(screen.getByText("browser")).toBeInTheDocument();
  });
});
