import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RunnerPool, RunnerPoolChange, RunnerPoolCreate } from "@/app/api/farm";
import type { FarmPollOptions } from "@/app/farm/farm-poll";
import { FarmScreen } from "@/app/farm/farm-screen";
import {
  CONFIGURE,
  CREATE,
  CREATED,
  DELETE,
  FIELDS_REFUSED,
  FIELD_LABELS,
  IMAGE_REQUIRED,
  KEEP,
  NAME_REQUIRED,
  NAME_TAKEN,
  NEW_POOL,
  NEW_POOL_VALUE,
  NOTHING_TO_SAVE,
  NO_POOLS_MEMBER_NOTE,
  PICKER_LABEL,
  POOLS_TITLE,
  POOL_MEMBER_REASON,
  type PoolDeleteOutcome,
  type PoolWriteOutcome,
  SAVE,
  SAVED,
  SHEET_CLOSE,
  SHEET_MEMBER_NOTE,
  SHEET_TITLE,
  deleteQuestion,
  deleteRefusal,
  deletedNote,
} from "@/app/farm/pools";
import { stampTheme } from "@/app/theme";

import { ADMIN_READER, MEMBER_READER, emptyFarm, farmReadings, runnerPool, seededFarm } from "../helpers/farm";
import { PALETTES, maskIds } from "../helpers/palettes";
import { settle } from "../helpers/settle";

const actions = vi.hoisted(() => ({
  createPool: vi.fn<(pool: RunnerPoolCreate) => Promise<PoolWriteOutcome>>(),
  updatePool: vi.fn<(id: string, change: RunnerPoolChange) => Promise<PoolWriteOutcome>>(),
  deletePool: vi.fn<(id: string) => Promise<PoolDeleteOutcome>>(),
}));

vi.mock("@/app/farm/pool-actions", () => ({
  createPool: (pool: RunnerPoolCreate) => actions.createPool(pool),
  updatePool: (id: string, change: RunnerPoolChange) => actions.updatePool(id, change),
  deletePool: (id: string) => actions.deletePool(id),
}));

// The enroll card (#258) shares the screen; this suite presses none of its actions.
vi.mock("@/app/farm/enroll-actions", () => ({
  mintEnrollCommand: vi.fn(),
  readEnrollmentTokens: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}));

/**
 * The pool configuration sheet on the farm screen (#259): its two doors, the picker, the image
 * field appearing only for a container pool, an executor edit and an allow-list edit round
 * tripping as the smallest change that says them, create, the guarded delete with its reason,
 * and the read-only form a member is given.
 */

/** A poll that never answers, so a case draws exactly what the server read. */
const QUIET: FarmPollOptions = { read: () => new Promise(() => {}), visible: () => true };

/** The seeded pools. */
const [POOL_A, POOL_B] = seededFarm().pools as [RunnerPool, RunnerPool];

/** An empty pool — one that may be deleted. */
const POOL_C = runnerPool({
  id: "5eed0400-0000-4000-8000-0000000000b3",
  name: "pool-c",
  description: "nightly macOS builds",
  executor: "shell",
  image: null,
  envAllowlist: [],
  autoscalePref: {},
  runners: 0,
});

/**
 * The open sheet.
 *
 * @returns The dialog.
 */
function sheet(): HTMLElement {
  return screen.getByRole("dialog", { name: SHEET_TITLE });
}

/**
 * The pools card.
 *
 * @returns Its section.
 */
function card(): HTMLElement {
  return screen.getByRole("region", { name: POOLS_TITLE });
}

/**
 * One of the form's fields, by its label.
 *
 * @param field Which.
 * @returns The control.
 */
function field(field: keyof typeof FIELD_LABELS): HTMLInputElement {
  return within(sheet()).getByLabelText(FIELD_LABELS[field]);
}

/**
 * Type into one of the form's fields.
 *
 * @param which Which field.
 * @param value What it should hold.
 */
function type(which: keyof typeof FIELD_LABELS, value: string): void {
  fireEvent.change(field(which), { target: { value } });
}

/**
 * Press a control in the sheet and let what it started settle (`../helpers/settle.ts`).
 *
 * @param name The control's name.
 */
async function press(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(within(sheet()).getByRole("button", { name }));
    await Promise.resolve();
  });
  await settle();
}

/**
 * Render the screen and open the sheet from the card.
 *
 * @param reader Who is reading.
 * @param pools The pools on the page.
 */
function open(reader = ADMIN_READER, pools: RunnerPool[] = [POOL_A, POOL_B]): void {
  render(<FarmScreen poll={QUIET} reader={reader} readings={farmReadings(seededFarm({ pools }))} />);
  fireEvent.click(within(card()).getByRole("button", { name: CONFIGURE }));
}

/**
 * Choose a pool in the picker.
 *
 * @param value The pool's id, or {@link NEW_POOL_VALUE}.
 */
function choose(value: string): void {
  fireEvent.change(within(sheet()).getByLabelText(PICKER_LABEL), { target: { value } });
}

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();

  actions.updatePool.mockImplementation((id, change) => {
    const pool = [POOL_A, POOL_B, POOL_C].find((held) => held.id === id) as RunnerPool;

    return Promise.resolve({ ok: true, pool: { ...pool, ...change } as RunnerPool });
  });
  actions.createPool.mockImplementation((pool) =>
    Promise.resolve({ ok: true, pool: runnerPool({ ...POOL_C, ...pool, id: "created", defaultCommand: null }) }),
  );
  actions.deletePool.mockResolvedValue({ ok: true });
});

afterEach(() => {
  stampTheme("system");
});

describe("the sheet's two doors", () => {
  it("opens from the card's Configure →, on the first pool, with every pool and + New pool to choose from", () => {
    open();

    const picker = within(sheet()).getByLabelText(PICKER_LABEL);

    expect(within(sheet()).getByRole("heading", { name: SHEET_TITLE })).toBeInTheDocument();
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "pool-a",
      "pool-b",
      NEW_POOL,
    ]);
    expect(picker).toHaveValue(POOL_A.id);
    expect(field("name")).toHaveValue("pool-a");
  });

  it("opens from the head's Pool settings too — which is no longer a soon", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings()} />);

    const control = screen.getByRole("button", { name: "Pool settings" });

    expect(control).not.toHaveAttribute("aria-disabled");
    fireEvent.click(control);

    expect(sheet()).toBeInTheDocument();
  });

  it("closes on Close and on Escape, and hands focus back to the door it was opened by", () => {
    open();
    fireEvent.click(within(sheet()).getByRole("button", { name: SHEET_CLOSE }));

    expect(screen.queryByRole("dialog")).toBeNull();

    const door = screen.getByRole("button", { name: "Pool settings" });
    door.focus();
    fireEvent.click(door);
    fireEvent.keyDown(sheet(), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(door).toHaveFocus();
  });

  it("writes nothing by being opened, read and closed", () => {
    open();
    choose(POOL_B.id);
    fireEvent.click(within(sheet()).getByRole("button", { name: SHEET_CLOSE }));

    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });
});

describe("the form", () => {
  it("opens holding the pool as configured", () => {
    open();

    expect(field("name")).toHaveValue("pool-a");
    expect(field("description")).toHaveValue("firmware builds");
    expect(field("executor")).toHaveValue("container");
    expect(field("image")).toHaveValue("ghcr.io/acme-robotics/zephyr-sdk:0.17");
    expect(field("envAllowlist")).toHaveValue("CCACHE_DIR\nWEST_TOPDIR\nZEPHYR_BASE");
    expect(field("maxConcurrency")).toHaveValue("2");
  });

  it("draws the image field for a container pool only", () => {
    open();
    expect(within(sheet()).queryByLabelText(FIELD_LABELS.image)).toBeInTheDocument();

    choose(POOL_B.id);

    expect(field("executor")).toHaveValue("shell");
    expect(within(sheet()).queryByLabelText(FIELD_LABELS.image)).toBeNull();
  });

  it("takes the image field away with the executor, and brings it back holding what was typed", () => {
    open();
    type("image", "ghcr.io/acme-robotics/zephyr-sdk:0.18");

    type("executor", "shell");
    expect(within(sheet()).queryByLabelText(FIELD_LABELS.image)).toBeNull();

    type("executor", "container");
    expect(field("image")).toHaveValue("ghcr.io/acme-robotics/zephyr-sdk:0.18");
  });

  it("never carries one pool's half-typed edit onto another", () => {
    open();
    type("description", "half typed");

    choose(POOL_B.id);
    expect(field("description")).toHaveValue("HIL & macOS jobs");

    choose(POOL_A.id);
    expect(field("description")).toHaveValue("firmware builds");
  });

  it("says what the executor decides, where it is decided", () => {
    open();

    expect(field("executor")).toHaveAccessibleDescription(/which runners dispatch can send them to/);
    expect(field("envAllowlist")).toHaveAccessibleDescription(/the runner drops every other name/);
    expect(field("maxConcurrency")).toHaveAccessibleDescription(/per runner, not per pool/);
  });

  it("offers nothing to save until something has changed", async () => {
    open();

    const save = within(sheet()).getByRole("button", { name: SAVE });

    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAttribute("title", NOTHING_TO_SAVE);

    await press(SAVE);
    expect(actions.updatePool).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("round-trips an executor edit as the pair the service checks, and the card follows", async () => {
    open();
    type("executor", "shell");

    await press(SAVE);

    expect(actions.updatePool).toHaveBeenCalledExactlyOnceWith(POOL_A.id, { executor: "shell", image: null });
    expect(within(sheet()).getByRole("status")).toHaveTextContent(SAVED);
    // The card's line is composed from the pool as the service answered it: no image any more.
    expect(card()).toHaveTextContent("firmware builds · 3 runners");
    expect(card()).not.toHaveTextContent("zephyr-sdk");
    // And the form matches the pool again.
    expect(within(sheet()).getByRole("button", { name: SAVE })).toHaveAttribute("title", NOTHING_TO_SAVE);
  });

  it("round-trips an allow-list edit as the list, and names nothing else", async () => {
    open();
    type("envAllowlist", "CCACHE_DIR\nZEPHYR_BASE\n\nCI");

    await press(SAVE);

    expect(actions.updatePool).toHaveBeenCalledExactlyOnceWith(POOL_A.id, {
      envAllowlist: ["CCACHE_DIR", "ZEPHYR_BASE", "CI"],
    });
    // As stored: one name per line, the blank line gone.
    expect(field("envAllowlist")).toHaveValue("CCACHE_DIR\nZEPHYR_BASE\nCI");
  });

  it("sends a shell pool turned container the image typed for it", async () => {
    open();
    choose(POOL_B.id);
    type("executor", "container");
    type("image", "img:1");

    await press(SAVE);

    expect(actions.updatePool).toHaveBeenCalledExactlyOnceWith(POOL_B.id, { executor: "container", image: "img:1" });
    expect(card()).toHaveTextContent("HIL & macOS jobs · img 1 image · 2 runners");
  });

  it("says what is wrong under the field, and sends nothing, when the form does not validate", async () => {
    open();
    type("name", " ");
    type("image", "");

    await press(SAVE);

    expect(actions.updatePool).not.toHaveBeenCalled();
    expect(field("name")).toHaveAccessibleDescription(new RegExp(NAME_REQUIRED));
    expect(field("name")).toBeInvalid();
    expect(field("image")).toHaveAccessibleDescription(new RegExp(IMAGE_REQUIRED));
  });

  it("drops a field's error as soon as the field is edited", async () => {
    open();
    type("name", "");
    await press(SAVE);

    type("name", "pool-x");

    expect(field("name")).not.toBeInvalid();
  });

  it("puts the service's refusal under the field it is about, and keeps what was typed", async () => {
    actions.updatePool.mockResolvedValue({ ok: false, reason: FIELDS_REFUSED, fields: { name: NAME_TAKEN } });
    open();
    type("name", "pool-b");

    await press(SAVE);

    expect(field("name")).toHaveAccessibleDescription(new RegExp(NAME_TAKEN));
    expect(field("name")).toHaveValue("pool-b");
    expect(within(sheet()).getByText(FIELDS_REFUSED)).toHaveAttribute("role", "alert");
    expect(within(sheet()).getByRole("status")).toBeEmptyDOMElement();
    // Nothing was written, so the card still reads as it did.
    expect(card()).toHaveTextContent("zephyr-sdk 0.17 image");
  });

  it("stops saying Saved once the reader edits again", async () => {
    open();
    type("maxConcurrency", "4");
    await press(SAVE);
    expect(within(sheet()).getByRole("status")).toHaveTextContent(SAVED);

    type("maxConcurrency", "5");

    expect(within(sheet()).getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("creating", () => {
  it("blanks the form for + New pool, as a container pool with no delete to offer", () => {
    open();
    choose(NEW_POOL_VALUE);

    expect(field("name")).toHaveValue("");
    expect(field("executor")).toHaveValue("container");
    expect(field("maxConcurrency")).toHaveValue("1");
    expect(within(sheet()).getByRole("button", { name: CREATE })).not.toHaveAttribute("aria-disabled");
    expect(within(sheet()).queryByRole("button", { name: /^Delete/ })).toBeNull();
  });

  it("creates the pool, then shows it — in the picker, in the form and on the card", async () => {
    open();
    choose(NEW_POOL_VALUE);
    type("name", "pool-c");
    type("description", "nightly macOS builds");
    type("executor", "shell");
    type("envAllowlist", "DEVELOPER_DIR");

    await press(CREATE);

    expect(actions.createPool).toHaveBeenCalledExactlyOnceWith({
      name: "pool-c",
      description: "nightly macOS builds",
      executor: "shell",
      image: null,
      envAllowlist: ["DEVELOPER_DIR"],
      maxConcurrency: 1,
    });
    expect(within(sheet()).getByRole("status")).toHaveTextContent(CREATED);
    expect(within(sheet()).getByLabelText(PICKER_LABEL)).toHaveValue("created");
    // The form was remounted for the new pool; focus is in the sheet, not on the page behind.
    expect(sheet()).toContainElement(document.activeElement as HTMLElement);
    expect(within(sheet()).getByRole("button", { name: SAVE })).toBeInTheDocument();
    expect(card()).toHaveTextContent("nightly macOS builds · no runners");
  });

  it("opens straight onto the blank form in a workspace with no pools", () => {
    render(<FarmScreen poll={QUIET} reader={ADMIN_READER} readings={farmReadings(emptyFarm())} />);
    fireEvent.click(within(card()).getByRole("button", { name: CONFIGURE }));

    expect(within(sheet()).queryByLabelText(PICKER_LABEL)).toBeNull();
    expect(within(sheet()).getByRole("button", { name: CREATE })).toBeInTheDocument();
  });

  it("asks for a name and an image before it sends anything", async () => {
    open();
    choose(NEW_POOL_VALUE);

    await press(CREATE);

    expect(actions.createPool).not.toHaveBeenCalled();
    expect(field("name")).toHaveAccessibleDescription(new RegExp(NAME_REQUIRED));
    expect(field("image")).toHaveAccessibleDescription(new RegExp(IMAGE_REQUIRED));
  });
});

describe("the guarded delete", () => {
  it("is blocked while runners remain, with the count on the control and the reason behind it", async () => {
    open();

    const control = within(sheet()).getByRole("button", { name: "Delete — blocked: 3 runners" });

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control.title).toContain("pool-a has 3 runners");

    await press("Delete — blocked: 3 runners");

    expect(within(sheet()).queryByText(deleteQuestion("pool-a"))).toBeNull();
    expect(actions.deletePool).not.toHaveBeenCalled();
  });

  it("asks before deleting an empty pool, and keeps it when the reader backs out", async () => {
    open(ADMIN_READER, [POOL_A, POOL_C]);
    choose(POOL_C.id);

    await press(DELETE);

    expect(within(sheet()).getByText(deleteQuestion("pool-c"))).toBeInTheDocument();
    expect(actions.deletePool).not.toHaveBeenCalled();

    await press(KEEP);

    expect(within(sheet()).queryByText(deleteQuestion("pool-c"))).toBeNull();
    expect(actions.deletePool).not.toHaveBeenCalled();
  });

  it("deletes it on the second press, takes it off the card and says so", async () => {
    open(ADMIN_READER, [POOL_A, POOL_C]);
    choose(POOL_C.id);

    await press(DELETE);
    await press("Delete pool-c");

    expect(actions.deletePool).toHaveBeenCalledExactlyOnceWith(POOL_C.id);
    expect(within(sheet()).getByRole("status")).toHaveTextContent(deletedNote("pool-c"));
    expect(within(sheet()).getByLabelText(PICKER_LABEL)).toHaveValue(POOL_A.id);
    expect(card()).not.toHaveTextContent("pool-c");
  });

  it("never leaves focus on the page behind: into the question, back out of it, and onto the picker after", async () => {
    open(ADMIN_READER, [POOL_A, POOL_C]);
    choose(POOL_C.id);

    // The pressed control is unmounted by the question it asks; focus goes to the safe answer.
    within(sheet()).getByRole("button", { name: DELETE }).focus();
    await press(DELETE);
    expect(within(sheet()).getByRole("button", { name: KEEP })).toHaveFocus();

    await press(KEEP);
    expect(within(sheet()).getByRole("button", { name: DELETE })).toHaveFocus();

    // And the delete unmounts the whole form: the picker takes focus, so Escape still closes.
    await press(DELETE);
    within(sheet()).getByRole("button", { name: "Delete pool-c" }).focus();
    await press("Delete pool-c");

    expect(within(sheet()).getByLabelText(PICKER_LABEL)).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves a reader who is typing where they are when the question goes away", async () => {
    open(ADMIN_READER, [POOL_A, POOL_C]);
    choose(POOL_C.id);
    await press(DELETE);

    // Enter in a field submits the form, which also withdraws the question.
    field("description").focus();
    type("description", "weekly macOS builds");
    await act(async () => {
      fireEvent.submit(sheet().querySelector("form") as HTMLFormElement);
      await Promise.resolve();
    });
    await settle();

    expect(within(sheet()).queryByText(deleteQuestion("pool-c"))).toBeNull();
    expect(field("description")).toHaveFocus();
  });

  it("shows the service's reason when builds or retired runners still name a pool the page shows empty", async () => {
    const reason = deleteRefusal({ code: "farm_pool_in_use", details: { runners: 1, jobs: 12 } });
    actions.deletePool.mockResolvedValue({ ok: false, reason });
    open(ADMIN_READER, [POOL_A, POOL_C]);
    choose(POOL_C.id);

    await press(DELETE);
    await press("Delete pool-c");

    expect(within(sheet()).getByRole("alert")).toHaveTextContent("1 runner (retired ones included) and 12 builds");
    expect(card()).toHaveTextContent("pool-c");
    // Back to the form's own actions, so the reader can disable it instead.
    expect(within(sheet()).getByRole("button", { name: DELETE })).toBeInTheDocument();
  });
});

describe("a reader who may not write", () => {
  beforeEach(() => {
    open(MEMBER_READER);
  });

  it("is told so once, and reads every pool's configuration in fields that cannot be typed into", () => {
    expect(within(sheet()).getByRole("note")).toHaveTextContent(SHEET_MEMBER_NOTE);

    for (const which of ["name", "description", "executor", "image", "envAllowlist", "maxConcurrency"] as const) {
      expect(field(which)).toBeDisabled();
    }

    choose(POOL_B.id);
    expect(field("description")).toHaveValue("HIL & macOS jobs");
  });

  it("is not offered + New pool", () => {
    const picker = within(sheet()).getByLabelText(PICKER_LABEL);

    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["pool-a", "pool-b"]);
  });

  it("finds save and delete inert, with the reason — and neither writes", async () => {
    for (const name of [SAVE, /^Delete/]) {
      const control = within(sheet()).getByRole("button", { name });

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAttribute("title", POOL_MEMBER_REASON);
      await press(name);
    }

    fireEvent.submit(sheet().querySelector("form") as HTMLFormElement);
    await settle();

    for (const mock of Object.values(actions)) expect(mock).not.toHaveBeenCalled();
  });
});

describe("a member in a workspace with no pools", () => {
  it("is told who creates the first one, and given no form", () => {
    render(<FarmScreen poll={QUIET} reader={MEMBER_READER} readings={farmReadings(emptyFarm())} />);
    fireEvent.click(within(card()).getByRole("button", { name: CONFIGURE }));

    expect(sheet()).toHaveTextContent(NO_POOLS_MEMBER_NOTE);
    expect(sheet().querySelector("form")).toBeNull();
  });
});

describe("both palettes", () => {
  it("draws one sheet under both, for an administrator and for a member", () => {
    for (const reader of [ADMIN_READER, MEMBER_READER]) {
      const drawn = PALETTES.map((palette) => {
        stampTheme(palette);
        open(reader);

        const html = maskIds(sheet().outerHTML);

        // Two mounted portals would answer every dialog query twice.
        cleanup();
        return html;
      });

      expect(drawn[0]).toBe(drawn[1]);
    }
  });
});
