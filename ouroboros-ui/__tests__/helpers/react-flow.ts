/**
 * What React Flow measures with, for a DOM that cannot measure.
 *
 * React Flow places nodes and routes edges from measured sizes — a `ResizeObserver` on every
 * node, `offsetWidth`/`offsetHeight` on the container, `DOMMatrixReadOnly` to read the
 * viewport's transform back, `getBBox()` for an edge's label — and jsdom implements none of
 * them, so a canvas rendered under it draws its stage and no nodes. This is the shim the
 * library's own testing guide gives (reactflow.dev › *Learn* › *Testing*), installed once per
 * suite: nodes measure as one pixel square, which is enough for every node to render at its
 * position and every edge to find its two ends.
 *
 * What a suite can then prove is what it could prove of any component under jsdom: the
 * markup, the positions React Flow writes into it, the handlers, the words. What it cannot
 * prove is a pixel — that the dot grid is 18px apart, that a pan is smooth — and no suite here
 * claims to.
 */

/**
 * A `ResizeObserver` that reports every observed element once, at once, with the box jsdom
 * measures it as — which is what the library reads its pan extent from.
 */
class ResizeObserverShim {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const contentRect = target.getBoundingClientRect();

    this.callback(
      [{ target, contentRect } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve(): void {}

  disconnect(): void {}
}

/** A `DOMMatrixReadOnly` that knows the one member React Flow reads: the scale. */
class DOMMatrixReadOnlyShim {
  readonly m22: number;

  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale === undefined ? 1 : Number(scale);
  }
}

/** Whether the shim is in place — it is installed once, however many suites ask. */
let installed = false;

/**
 * Give jsdom what React Flow needs to render a graph.
 *
 * @returns Nothing. Call it at the top of any suite that renders the canvas, before the first
 *   render; a second call is a no-op.
 */
export function shimReactFlow(): void {
  if (installed) return;
  installed = true;

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverShim,
  });
  Object.defineProperty(globalThis, "DOMMatrixReadOnly", {
    configurable: true,
    writable: true,
    value: DOMMatrixReadOnlyShim,
  });
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.height) || 1;
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style.width) || 1;
      },
    },
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    writable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
  // A click-to-connect asks for the handle under the pointer first and falls back to the handle
  // that was clicked; jsdom lays nothing out, so there is never an element under a point.
  Object.defineProperty(Document.prototype, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: () => null,
  });
}
