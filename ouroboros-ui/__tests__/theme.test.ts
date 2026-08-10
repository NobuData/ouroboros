import { afterEach, describe, expect, it } from "vitest";

import {
  DARK_MEDIA_QUERY,
  THEME_ATTRIBUTE,
  THEME_BOOTSTRAP,
  THEME_STORAGE_KEY,
  type Theme,
  parseTheme,
  readStoredTheme,
  resolveTheme,
  stampTheme,
  storeTheme,
  systemTheme,
} from "@/app/theme";

import { hostileStorage, installMatchMedia, memoryStorage } from "./helpers/match-media";

afterEach(() => {
  document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  window.localStorage.clear();
});

describe("parseTheme", () => {
  it.each<Theme>(["light", "dark", "system"])("keeps %s", (value) => {
    expect(parseTheme(value)).toBe(value);
  });

  it.each([
    ["nothing stored", null],
    ["undefined", undefined],
    ["a value from an older version", "auto"],
    ["a hand-edited key", "Dark"],
    ["an empty string", ""],
  ])("reads %s as system", (_case, value) => {
    expect(parseTheme(value)).toBe("system");
  });
});

describe("readStoredTheme", () => {
  it("returns the stored choice", () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
  });

  it("returns system when nothing is stored", () => {
    expect(readStoredTheme(memoryStorage())).toBe("system");
  });

  it("returns system rather than throwing when storage is blocked", () => {
    expect(readStoredTheme(hostileStorage())).toBe("system");
  });

  it("returns system when there is no storage at all", () => {
    expect(readStoredTheme(undefined)).toBe("system");
  });
});

describe("storeTheme", () => {
  it.each(["light", "dark"] as const)("writes %s", (theme) => {
    const storage = memoryStorage();
    storeTheme(theme, storage);

    expect(storage.getItem(THEME_STORAGE_KEY)).toBe(theme);
  });

  it("stores system as the absence of the key, so there is one representation of it", () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: "dark" });
    storeTheme("system", storage);

    expect(storage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("round-trips every choice through readStoredTheme", () => {
    const storage = memoryStorage();

    for (const theme of ["light", "dark", "system"] as const) {
      storeTheme(theme, storage);
      expect(readStoredTheme(storage)).toBe(theme);
    }
  });

  it("does not throw when storage refuses the write", () => {
    expect(() => storeTheme("dark", hostileStorage())).not.toThrow();
    expect(() => storeTheme("system", hostileStorage())).not.toThrow();
  });
});

describe("systemTheme", () => {
  it("reports dark when the OS prefers dark", () => {
    const media = installMatchMedia(true, DARK_MEDIA_QUERY);
    try {
      expect(systemTheme()).toBe("dark");
    } finally {
      media.restore();
    }
  });

  it("reports light when the OS does not", () => {
    const media = installMatchMedia(false, DARK_MEDIA_QUERY);
    try {
      expect(systemTheme()).toBe("light");
    } finally {
      media.restore();
    }
  });

  it("reports light when matchMedia is unavailable, matching the sheet's base palette", () => {
    expect(systemTheme({} as Window)).toBe("light");
  });

  it("reports light on the server, where there is no window", () => {
    expect(systemTheme(undefined)).toBe("light");
  });
});

describe("resolveTheme", () => {
  it.each(["light", "dark"] as const)("passes %s through without asking the OS", (theme) => {
    // An explicit choice must beat the OS — the property the sheet's
    // :root:not([data-theme="light"]) exists to preserve.
    const media = installMatchMedia(theme === "light", DARK_MEDIA_QUERY);
    try {
      expect(resolveTheme(theme)).toBe(theme);
    } finally {
      media.restore();
    }
  });

  it.each([
    ["dark", true],
    ["light", false],
  ] as const)("resolves system to %s from the OS", (expected, prefersDark) => {
    const media = installMatchMedia(prefersDark, DARK_MEDIA_QUERY);
    try {
      expect(resolveTheme("system")).toBe(expected);
    } finally {
      media.restore();
    }
  });
});

describe("stampTheme", () => {
  it.each(["light", "dark"] as const)("puts %s on the element", (theme) => {
    const root = document.createElement("html");
    stampTheme(theme, root);

    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe(theme);
  });

  it("expresses system by removing the attribute, not by writing the word", () => {
    const root = document.createElement("html");
    root.setAttribute(THEME_ATTRIBUTE, "dark");

    stampTheme("system", root);

    // Nothing on <html> is what the token sheet reads as system, so CSS resolves the OS
    // preference with no JavaScript involved.
    expect(root.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it("replaces a previous choice rather than adding to it", () => {
    const root = document.createElement("html");

    stampTheme("dark", root);
    stampTheme("light", root);

    expect(root.getAttribute(THEME_ATTRIBUTE)).toBe("light");
  });

  it("defaults to the document element", () => {
    stampTheme("dark");

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });
});

describe("the inline bootstrap script", () => {
  /**
   * Run the boot script the way the browser does — as source, in this document.
   *
   * @returns Nothing; assertions read `document.documentElement`.
   */
  const boot = () => {
    new Function(THEME_BOOTSTRAP)();
  };

  it("is built from the constants the rest of the engine uses", () => {
    // The reason the script is generated rather than written out: a key or attribute
    // renamed in one place and not the other is a bug that only shows up on a return
    // visit.
    expect(THEME_BOOTSTRAP).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(THEME_BOOTSTRAP).toContain(JSON.stringify(THEME_ATTRIBUTE));
  });

  it("cannot break out of the script element it is inlined into", () => {
    expect(THEME_BOOTSTRAP).not.toMatch(/<\/script/i);
  });

  it.each(["light", "dark"] as const)("stamps a stored %s choice", (theme) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);

    boot();

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(theme);
  });

  it("stamps nothing when there is no stored choice, leaving system to CSS", () => {
    boot();

    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it("stamps nothing for a value it does not recognise", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");

    boot();

    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
  });

  it("never consults the OS, because absence is what tracks it", () => {
    const media = installMatchMedia(true, DARK_MEDIA_QUERY);
    try {
      boot();

      // A boot script that stamped the resolved value here would freeze the palette:
      // the attribute would stop the sheet's prefers-color-scheme block from applying,
      // and an OS change would need JavaScript to be noticed.
      expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    } finally {
      media.restore();
    }
  });

  it("does not write to storage", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

    boot();

    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("survives storage that throws on access", () => {
    const original = window.localStorage;
    // Safari's private mode throws when the property itself is read, not when a method
    // on it is called — which is why the engine's `try` wraps the access and not just
    // the call.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage is disabled", "SecurityError");
      },
    });

    try {
      // A boot script that threw would abort before the rest of the page's inline
      // scripts ran, which is a worse failure than an unremembered theme.
      expect(boot).not.toThrow();
      expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false);
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  it("stays small enough to block the parser without cost", () => {
    // It is parser-blocking by design. The number is a ceiling, not a target: it exists
    // so that "keep it tiny" survives the next edit.
    expect(THEME_BOOTSTRAP.length).toBeLessThan(300);
  });
});
