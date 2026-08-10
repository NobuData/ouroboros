/**
 * A controllable `window.matchMedia`, because jsdom's never changes.
 *
 * jsdom implements `matchMedia`, but its lists always report `matches: false` and never
 * fire `change` — so "system tracks the OS live" cannot be tested against it. This
 * installs a stub whose answer is settable and which dispatches `change` to every
 * listener when the answer moves, the way a real browser does when the OS theme flips.
 */

/** Handle for driving the installed stub. */
export interface MediaController {
  /** Set what the query answers, firing `change` on every listener if it moved. */
  set(matches: boolean): void;
  /** How many listeners are currently attached — used to assert cleanup. */
  listenerCount(): number;
  /** Restore whatever `matchMedia` was there before. */
  restore(): void;
}

type ChangeListener = (event: MediaQueryListEvent) => void;

/**
 * Install the stub on `window`.
 *
 * @param matches What the query answers to begin with — `true` means the OS prefers dark.
 * @param query The query the stub answers for. Any other query gets a list that never
 *   matches, so a test cannot pass by listening to the wrong thing.
 * @returns A {@link MediaController} for driving and removing the stub.
 */
export function installMatchMedia(matches: boolean, query: string): MediaController {
  const original = window.matchMedia;
  const listeners = new Set<ChangeListener>();
  let current = matches;

  const list = (media: string): MediaQueryList => {
    const answers = media === query;
    const self = {
      get matches() {
        return answers && current;
      },
      media,
      onchange: null,
      addEventListener: (type: string, listener: ChangeListener) => {
        if (answers && type === "change") listeners.add(listener);
      },
      removeEventListener: (type: string, listener: ChangeListener) => {
        if (type === "change") listeners.delete(listener);
      },
      // The deprecated half of the API. Present so the object satisfies MediaQueryList;
      // nothing in this module calls them.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    };
    return self as unknown as MediaQueryList;
  };

  window.matchMedia = ((media: string) => list(media)) as typeof window.matchMedia;

  return {
    set(next: boolean) {
      if (next === current) return;
      current = next;
      const event = { matches: next, media: query } as MediaQueryListEvent;
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
    restore() {
      window.matchMedia = original;
      listeners.clear();
    },
  };
}

/**
 * A `Storage` that throws on every operation.
 *
 * Safari's private mode does this, and a visitor there should still get a working page —
 * a theme that applies for the session and simply is not remembered.
 *
 * @returns A storage whose every method throws.
 */
export function hostileStorage(): Storage {
  const refuse = (): never => {
    throw new DOMException("storage is disabled", "SecurityError");
  };

  return {
    get length(): number {
      return refuse();
    },
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

/**
 * A plain in-memory `Storage`.
 *
 * @param initial Entries to start with.
 * @returns A storage backed by a Map, so a test can assert what was written.
 */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial));

  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}
