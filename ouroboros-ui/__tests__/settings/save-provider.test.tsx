import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ReactNode, Suspense, use, useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type SettingsAccess, settingsAccess } from "@/app/settings/access";
import {
  NOTHING_TO_SAVE,
  SAVED_NOTICE,
  SAVE_INTERRUPTED,
  SAVING_LABEL,
  type SectionCommitResult,
} from "@/app/settings/save-model";
import { IMMEDIATE_MARK, type SettingsSectionId } from "@/app/settings/view";

import { settle } from "../helpers/settle";

/**
 * The settings save model, met by React (BS.1,
 * [#491](https://github.com/NobuData/ouroboros/issues/491), decision S7): a card joins as the
 * section its seat names, the head's button and the dirty bar read one count, a save commits a
 * section at a time and routes what was wrong back to the inputs, and read-only is a rendering
 * mode rather than a page of switched-off controls.
 *
 * The fixture is two cards a suite can steer — each write answers what the case hands it —
 * mounted in the real seats under the real provider. `save-model.test.ts` covers the
 * bookkeeping; this is where it meets a component.
 */

/** What tells the page to re-read after a write landed. */
const refresh = vi.fn();

/** The framework's own signals are rethrown by this; nothing else is. */
const rethrow = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  unstable_rethrow: (error: unknown) => {
    rethrow(error);
  },
}));

const { SettingsDirtyBar, SaveButton } = await import("@/app/settings/save-controls");
const { SettingsSaveProvider, useSettingsSave, useSettingsSection } = await import(
  "@/app/settings/save-provider"
);
const { SectionMarks, SettingsSeat } = await import("@/app/settings/settings-seat");

/** The workspace fixture's fields. */
interface WorkspaceValues {
  readonly name: string;
  readonly domain: string;
}

/** What the fixture service holds. */
const SAVED: WorkspaceValues = { name: "acme-robotics", domain: "acme.ouroboros.dev" };

/** A write that lands. */
const landed = (): Promise<SectionCommitResult> => Promise.resolve({ ok: true });

/**
 * The router's re-read, as a suite can hold it.
 *
 * `router.refresh()` is a transition that stays pending until the fresh page has rendered, and
 * the save model's landed overlay lasts exactly that long — which a mock that returns at once
 * cannot show. So a case that needs to stand inside the re-read sets `reread.hold`, and the
 * mocked `refresh` then suspends {@link Reread} on a promise the case resolves with
 * `reread.arrive()`: the same shape, a transition waiting on data.
 */
const reread = {
  /** Whether the next `refresh` should stay pending until {@link reread.arrive}. */
  hold: false,
  /** Let the held re-read finish. */
  arrive: (): void => {},
  /** Suspend the probe. Set by {@link Reread} while it is mounted. */
  suspend: (() => {}) as (waiting: Promise<void>) => void,
};

/**
 * The probe a held re-read suspends: it renders nothing, and waits when told to.
 *
 * @returns Nothing.
 */
function Reread() {
  const [waiting, setWaiting] = useState<Promise<void> | null>(null);

  useEffect(() => {
    reread.suspend = setWaiting;

    return () => {
      reread.suspend = () => {};
    };
  }, []);

  if (waiting !== null) use(waiting);

  return null;
}

/**
 * A fixture card: two text fields that join the save model as the section they are mounted in.
 *
 * @param props.baseline What the service holds.
 * @param props.commit The write.
 * @param props.validate The browser's check, if any.
 * @returns The card.
 */
function WorkspaceCard({
  baseline = SAVED,
  commit = landed,
  validate,
}: Readonly<{
  baseline?: WorkspaceValues;
  commit?: (changes: Partial<WorkspaceValues>, draft: WorkspaceValues) => Promise<SectionCommitResult>;
  validate?: (draft: WorkspaceValues) => Partial<Record<keyof WorkspaceValues, string>>;
}>) {
  const fields = useSettingsSection<WorkspaceValues>({
    baseline,
    commit,
    validate,
    labels: { name: "Workspace name", domain: "Tenant domain" },
  });

  return (
    <section aria-label="Workspace card">
      <SectionMarks />
      {(["name", "domain"] as const).map((field) => (
        <div key={field}>
          <label htmlFor={fields.id(field)}>{field}</label>
          <input
            aria-invalid={fields.error(field) === undefined ? undefined : true}
            data-dirty={fields.isDirty(field)}
            id={fields.id(field)}
            onChange={(event) => {
              fields.set(field, event.target.value);
            }}
            readOnly={!fields.editable}
            value={fields.values[field]}
          />
          {fields.error(field) !== undefined && <p data-error={field}>{fields.error(field)}</p>}
        </div>
      ))}
      {fields.refusal !== null && <p data-refusal>{fields.refusal}</p>}
      {/* A span, not an `<output>`: that element is a `status`, and the page has one. */}
      <span data-pending>{fields.pending}</span>
    </section>
  );
}

/**
 * A second fixture card, for the Notifications seat: one field.
 *
 * @param props.commit The write.
 * @returns The card.
 */
function ChannelCard({
  commit = landed,
}: Readonly<{ commit?: (changes: { channel?: string }) => Promise<SectionCommitResult> }>) {
  const fields = useSettingsSection<{ channel: string }>({
    baseline: { channel: "#eng-leads" },
    commit,
    labels: { channel: "Weekly report channel" },
  });

  return (
    <div>
      <label htmlFor={fields.id("channel")}>channel</label>
      <input
        id={fields.id("channel")}
        onChange={(event) => {
          fields.set("channel", event.target.value);
        }}
        readOnly={!fields.editable}
        value={fields.values.channel}
      />
    </div>
  );
}

const OWNER = settingsAccess(["owner"]);
const VIEWER = settingsAccess(["viewer"]);

/**
 * Draw the page: the provider, the head's button, the bar, and the given seats.
 *
 * @param children The seats.
 * @param access Who the reader is. Defaults to an owner.
 * @returns The render result.
 */
function page(children: ReactNode, access: SettingsAccess = OWNER) {
  return render(
    <SettingsSaveProvider access={access}>
      <div data-head>
        <SaveButton />
      </div>
      <SettingsDirtyBar />
      {children}
    </SettingsSaveProvider>,
  );
}

/** One fixture seat holding a card. */
function seat(section: SettingsSectionId, card: ReactNode) {
  return <SettingsSeat section={section}>{card}</SettingsSeat>;
}

/** The head's Save button. */
function headSave(): HTMLElement {
  return within(document.querySelector("[data-head]") as HTMLElement).getByRole("button");
}

/** The dirty bar, or `null` on a clean page. */
function bar(): HTMLElement | null {
  return document.querySelector(".settings-dirty");
}

/**
 * Type into a field.
 *
 * @param name The field's label.
 * @param value What to set it to.
 */
function type(name: string, value: string): void {
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
}

/** Press Save, and let the save settle. */
async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(headSave());
  });
  await settle();
}

beforeEach(() => {
  rethrow.mockClear();
  reread.hold = false;
  refresh.mockReset();
  refresh.mockImplementation(() => {
    if (!reread.hold) return;

    reread.suspend(
      new Promise<void>((resolve) => {
        reread.arrive = resolve;
      }),
    );
  });
});

describe("a clean page", () => {
  it("draws Save changes inert, with the reason, and no bar", () => {
    page(seat("workspace", <WorkspaceCard />));

    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(headSave()).toHaveAttribute("aria-disabled", "true");
    expect(headSave()).toHaveAttribute("title", NOTHING_TO_SAVE);
    expect(bar()).toBeNull();
  });

  it("draws what the service holds", () => {
    page(seat("workspace", <WorkspaceCard />));

    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("domain")).toHaveValue("acme.ouroboros.dev");
  });

  it("keeps the live region mounted, so the save's notice can be announced into it", () => {
    page(seat("workspace", <WorkspaceCard />));

    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("sends nothing when the inert button is pressed anyway", async () => {
    const commit = vi.fn(landed);
    page(seat("workspace", <WorkspaceCard commit={commit} />));

    await save();

    expect(commit).not.toHaveBeenCalled();
  });
});

describe("the dirty count", () => {
  it("counts each field that differs from what is saved, on the button and the bar alike", () => {
    page(
      <>
        {seat("workspace", <WorkspaceCard />)}
        {seat("notifications", <ChannelCard />)}
      </>,
    );

    type("name", "acme-2");
    expect(headSave()).toHaveTextContent("Save changes (1)");
    expect(headSave()).not.toHaveAttribute("aria-disabled");

    type("domain", "new.ouroboros.dev");
    type("channel", "#eng-all");

    expect(headSave()).toHaveTextContent("Save changes (3)");
    expect(within(bar() as HTMLElement).getAllByRole("status")[0]).toHaveTextContent(
      "3 unsaved changes",
    );
    expect(within(bar() as HTMLElement).getByRole("button", { name: "Save changes (3)" })).toBeInTheDocument();
  });

  it("drops a field set back to what is saved, and the bar with the last of them", () => {
    page(seat("workspace", <WorkspaceCard />));

    type("name", "acme-2");
    type("name", "acme-robotics");

    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(bar()).toBeNull();
  });

  it("marks the field and the section that are unsaved", () => {
    page(seat("workspace", <WorkspaceCard />));

    expect(document.querySelector(".settings__unsaved")).toBeNull();

    type("name", "acme-2");

    expect(screen.getByLabelText("name")).toHaveAttribute("data-dirty", "true");
    expect(screen.getByLabelText("domain")).toHaveAttribute("data-dirty", "false");
    expect(document.querySelector(".settings__unsaved")).toHaveTextContent("1 unsaved");
    expect(document.querySelector("[data-pending]")).toHaveTextContent("1");
  });

  it("is in the asking bar, stuck under the tab row", () => {
    page(seat("workspace", <WorkspaceCard />));

    type("name", "acme-2");

    expect(bar()).toHaveClass("ou-sticky-bar", "ou-sticky-bar--asking");
  });
});

describe("discarding", () => {
  it("puts every field back to what is saved and takes the bar away", () => {
    page(seat("workspace", <WorkspaceCard />));
    type("name", "acme-2");
    type("domain", "x.dev");

    fireEvent.click(within(bar() as HTMLElement).getByRole("button", { name: "Discard" }));

    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("domain")).toHaveValue("acme.ouroboros.dev");
    expect(bar()).toBeNull();
  });
});

describe("saving", () => {
  it("sends each section's changes once, announces it, and asks the page to re-read", async () => {
    const commit = vi.fn(landed);
    page(seat("workspace", <WorkspaceCard commit={commit} />));
    type("name", "acme-2");

    await save();

    expect(commit).toHaveBeenCalledExactlyOnceWith(
      { name: "acme-2" },
      { name: "acme-2", domain: "acme.ouroboros.dev" },
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(SAVED_NOTICE);
    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(bar()).toBeNull();
  });

  it("goes on drawing what landed for as long as the re-read takes, and no longer", async () => {
    reread.hold = true;
    const view = render(
      <SettingsSaveProvider access={OWNER}>
        <div data-head>
          <SaveButton />
        </div>
        <SettingsDirtyBar />
        <Suspense fallback={null}>
          <Reread />
        </Suspense>
        {seat("workspace", <WorkspaceCard />)}
      </SettingsSaveProvider>,
    );
    type("name", "acme-2");

    await save();

    // The write has landed and the page has not been re-read yet: the card's baseline is
    // still the old name, and without the overlay the field would flash back to it. The save
    // is still in flight — the re-read is part of it — so the fields are still held.
    expect(refresh).toHaveBeenCalledOnce();
    expect(headSave()).toHaveTextContent(SAVING_LABEL);
    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
    expect(screen.getByLabelText("name")).toHaveAttribute("data-dirty", "false");
    expect(screen.getByLabelText("name")).toHaveAttribute("readonly");
    expect(bar()).toBeNull();

    // The re-read finishes: the save is over, and the fields are the reader's again.
    await act(async () => {
      reread.arrive();
      // A turn of the event loop, for the suspended transition to be retried and committed.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(screen.getByLabelText("name")).not.toHaveAttribute("readonly");
    // …and the overlay with it: what is drawn now is the page's own read. (The real re-read
    // delivers the fresh baseline in the same commit; this suite hands it over next.)
    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");

    view.rerender(
      <SettingsSaveProvider access={OWNER}>
        <div data-head>
          <SaveButton />
        </div>
        <SettingsDirtyBar />
        <Suspense fallback={null}>
          <Reread />
        </Suspense>
        {seat("workspace", <WorkspaceCard baseline={{ ...SAVED, name: "Acme-2" }} />)}
      </SettingsSaveProvider>,
    );
    await settle();

    expect(screen.getByLabelText("name")).toHaveValue("Acme-2");
    expect(headSave()).toHaveTextContent(/^Save changes$/);
  });

  it("takes the page's word once it has been re-read — even when the service kept what it had", async () => {
    // The service trims: "acme-robotics " is saved as "acme-robotics", which is what it held.
    // The baseline never changes, and it is still the truth.
    page(seat("workspace", <WorkspaceCard />));
    type("name", "acme-robotics ");

    await save();

    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(headSave()).toHaveTextContent(/^Save changes$/);

    // Typing the saved value is then no change at all.
    type("name", "acme-robotics");
    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(bar()).toBeNull();
  });

  it("says Saving… and holds every field still while the write is in flight", async () => {
    let answer: (result: SectionCommitResult) => void = () => {};
    const commit = vi.fn(
      () =>
        new Promise<SectionCommitResult>((resolve) => {
          answer = resolve;
        }),
    );
    page(seat("workspace", <WorkspaceCard commit={commit} />));
    type("name", "acme-2");

    await act(async () => {
      fireEvent.click(headSave());
    });

    expect(headSave()).toHaveTextContent(SAVING_LABEL);
    expect(headSave()).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText("name")).toHaveAttribute("readonly");
    expect(within(bar() as HTMLElement).getByRole("button", { name: "Discard" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // A second press while one is in flight is not a second request.
    fireEvent.click(headSave());
    expect(commit).toHaveBeenCalledOnce();

    // Resolved inside the case: a write left hanging entangles every later case's actions.
    await act(async () => {
      answer({ ok: true });
    });
    await settle();

    expect(headSave()).toHaveTextContent(/^Save changes$/);
  });

  it("commits sections in page order and stops at the first refusal", async () => {
    const order: string[] = [];
    const workspace = vi.fn((): Promise<SectionCommitResult> => {
      order.push("workspace");
      return Promise.resolve({
        ok: false,
        reason: "The workspace was not changed.",
        fields: { domain: "Already in use." },
      });
    });
    const channel = vi.fn((): Promise<SectionCommitResult> => {
      order.push("notifications");
      return Promise.resolve({ ok: true });
    });
    page(
      <>
        {seat("notifications", <ChannelCard commit={channel} />)}
        {seat("workspace", <WorkspaceCard commit={workspace} />)}
      </>,
    );
    type("channel", "#eng-all");
    type("domain", "taken.dev");

    await save();

    // Workspace is drawn first on the page, wherever its card sits in this fixture.
    expect(order).toEqual(["workspace"]);
    expect(channel).not.toHaveBeenCalled();
    expect(headSave()).toHaveTextContent("Save changes (2)");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a refusal", () => {
  /** A workspace write the service refuses for its domain. */
  const refused = (): Promise<SectionCommitResult> =>
    Promise.resolve({
      ok: false,
      reason: "The workspace was not changed.",
      fields: { domain: "That domain is already used by another workspace." },
    });

  it("routes the error to its input, keeps the edit, and says which field in the bar", async () => {
    page(seat("workspace", <WorkspaceCard commit={refused} />));
    type("domain", "taken.dev");

    await save();

    expect(document.querySelector("[data-error='domain']")).toHaveTextContent(
      "That domain is already used by another workspace.",
    );
    expect(screen.getByLabelText("domain")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("domain")).toHaveValue("taken.dev");
    expect(document.querySelector("[data-error='name']")).toBeNull();
    expect(document.querySelector("[data-refusal]")).toHaveTextContent("The workspace was not changed.");
    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Not saved — Workspace: Tenant domain — That domain is already used by another workspace.",
    );
    expect(headSave()).toHaveTextContent("Save changes (1)");
  });

  it("takes the reader to the input the error is about", async () => {
    page(seat("workspace", <WorkspaceCard commit={refused} />));
    type("domain", "taken.dev");

    await save();

    expect(screen.getByLabelText("domain")).toHaveFocus();
  });

  it("takes them there again when the same field is refused twice", async () => {
    page(seat("workspace", <WorkspaceCard commit={refused} />));
    type("domain", "taken.dev");
    await save();

    screen.getByLabelText("name").focus();
    type("domain", "still-taken.dev");
    await save();

    expect(screen.getByLabelText("domain")).toHaveFocus();
  });

  it("clears the field's error and the bar's sentence at the next edit", async () => {
    page(seat("workspace", <WorkspaceCard commit={refused} />));
    type("domain", "taken.dev");
    await save();

    type("domain", "free.dev");

    expect(document.querySelector("[data-error='domain']")).toBeNull();
    expect(within(bar() as HTMLElement).queryByRole("alert")).toBeNull();
  });

  it("says what landed and what was not sent when a later section is refused", async () => {
    const channel = (): Promise<SectionCommitResult> =>
      Promise.resolve({ ok: false, reason: "Refused.", fields: { channel: "A channel starts with #." } });
    const workspace = vi.fn(landed);
    page(
      <>
        {seat("workspace", <WorkspaceCard commit={workspace} />)}
        {seat("notifications", <ChannelCard commit={channel} />)}
      </>,
    );
    type("name", "acme-2");
    type("channel", "eng");

    await save();

    expect(workspace).toHaveBeenCalledOnce();
    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Not saved — Notifications: Weekly report channel — A channel starts with #. Saved: Workspace.",
    );
    // The landed section is saved and no longer counted; the refused one still is.
    expect(headSave()).toHaveTextContent("Save changes (1)");
    expect(screen.getByLabelText("name")).toHaveAttribute("data-dirty", "false");
    // What landed is re-read even though the save as a whole did not finish.
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("channel")).toHaveFocus();
  });
});

describe("the browser's own check", () => {
  /** A workspace needs a name. */
  const validate = (draft: WorkspaceValues) =>
    draft.name.trim() === "" ? { name: "A workspace needs a name." } : {};

  it("stops the save before anything is sent — in every section", async () => {
    const workspace = vi.fn(landed);
    const channel = vi.fn(landed);
    page(
      <>
        {seat("workspace", <WorkspaceCard commit={workspace} validate={validate} />)}
        {seat("notifications", <ChannelCard commit={channel} />)}
      </>,
    );
    type("name", "");
    type("channel", "#eng-all");

    await save();

    expect(workspace).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(document.querySelector("[data-error='name']")).toHaveTextContent("A workspace needs a name.");
    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(
      "Nothing was saved. Workspace: Workspace name — A workspace needs a name.",
    );
    expect(screen.getByLabelText("name")).toHaveFocus();
    expect(headSave()).toHaveTextContent("Save changes (2)");
  });

  it("lets the save through once the field is put right", async () => {
    const workspace = vi.fn(landed);
    page(seat("workspace", <WorkspaceCard commit={workspace} validate={validate} />));
    type("name", "");
    await save();

    type("name", "acme-2");
    await save();

    expect(workspace).toHaveBeenCalledExactlyOnceWith(
      { name: "acme-2" },
      { name: "acme-2", domain: "acme.ouroboros.dev" },
    );
  });
});

describe("a write that fails without an answer", () => {
  it("is a refusal the reader can retry from, with every edit kept", async () => {
    const dropped = new TypeError("fetch failed");
    page(seat("workspace", <WorkspaceCard commit={() => Promise.reject(dropped)} />));
    type("name", "acme-2");

    await save();

    // Not the page's error boundary: that would take the unsaved edit with it.
    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
    expect(headSave()).toHaveTextContent("Save changes (1)");
    expect(within(bar() as HTMLElement).getByRole("alert")).toHaveTextContent(SAVE_INTERRUPTED);
    // The framework's own signals are offered the error first, and rethrow what is theirs.
    expect(rethrow).toHaveBeenCalledWith(dropped);
  });
});

describe("a reader who may not edit", () => {
  it("is drawn the same values, read-only, with nothing to count", () => {
    page(seat("workspace", <WorkspaceCard />), VIEWER);

    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("name")).toHaveAttribute("readonly");

    type("name", "acme-2");

    // The edit did not take: the dirty state is empty by construction, not by a disabled input.
    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(bar()).toBeNull();
  });

  it("cannot save, even by pressing a Save button a page drew for them", async () => {
    const commit = vi.fn(landed);
    page(seat("workspace", <WorkspaceCard commit={commit} />), VIEWER);

    await save();

    expect(commit).not.toHaveBeenCalled();
  });
});

describe("a reader who stops being allowed to edit", () => {
  it("holds no edits: the bar, the count and the drafts go with the right to make them", () => {
    const view = page(seat("workspace", <WorkspaceCard />));
    type("name", "acme-2");
    expect(headSave()).toHaveTextContent("Save changes (1)");

    // A re-read arrives after a demotion: the same page, for a reader who may now only look.
    view.rerender(
      <SettingsSaveProvider access={VIEWER}>
        <div data-head>
          <SaveButton />
        </div>
        <SettingsDirtyBar />
        {seat("workspace", <WorkspaceCard />)}
      </SettingsSaveProvider>,
    );

    expect(bar()).toBeNull();
    expect(headSave()).toHaveTextContent(/^Save changes$/);
    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("name")).toHaveAttribute("data-dirty", "false");
  });
});

describe("one card per section", () => {
  it("refuses a second card joining the same section, rather than letting it replace the first", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      page(
        seat(
          "workspace",
          <>
            <WorkspaceCard />
            <ChannelCard />
          </>,
        ),
      ),
    ).toThrow(/"Workspace" section already has a card joined to the save model/);

    quiet.mockRestore();
  });

  it("lets a card be replaced by another: the first leaves before the second joins", () => {
    const view = page(seat("workspace", <WorkspaceCard key="first" />));

    expect(() => {
      view.rerender(
        <SettingsSaveProvider access={OWNER}>
          <div data-head>
            <SaveButton />
          </div>
          <SettingsDirtyBar />
          {seat("workspace", <WorkspaceCard key="second" />)}
        </SettingsSaveProvider>,
      );
    }).not.toThrow();

    type("name", "acme-2");
    expect(headSave()).toHaveTextContent("Save changes (1)");
  });
});

describe("the Danger zone", () => {
  it("cannot hold a field: a card mounted in it throws rather than be left out of Save", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => page(seat("danger", <WorkspaceCard />))).toThrow(
      /Danger zone.*act immediately.*cannot be fields saved by Save changes/,
    );
    expect(() => page(seat("appearance", <WorkspaceCard />))).toThrow(/Appearance/);

    quiet.mockRestore();
  });

  it("is marked as applying at once, always", () => {
    page(seat("danger", <SectionMarks />));

    expect(screen.getByText(IMMEDIATE_MARK)).toHaveClass("ou-tag");
  });
});

describe("outside the page", () => {
  it("draws a card read-only over what it was given, rather than throwing", () => {
    render(<WorkspaceCard />);

    expect(screen.getByLabelText("name")).toHaveValue("acme-robotics");
    expect(screen.getByLabelText("name")).toHaveAttribute("readonly");
    expect(document.querySelector("[data-pending]")).toHaveTextContent("0");
  });

  it("answers a read-only page with nothing unsaved to a component with no provider", () => {
    /** Reads the model with nothing above it. */
    function Probe() {
      const model = useSettingsSave();

      return (
        <span data-probe>
          {`${model.access.tier}:${String(model.pending)}:${String(model.sectionPending("workspace"))}`}
        </span>
      );
    }

    render(<Probe />);

    expect(document.querySelector("[data-probe]")).toHaveTextContent("read-only:0:0");
  });

  it("draws no marker outside a seat", () => {
    const { container } = render(<SectionMarks />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("a card leaving the page", () => {
  it("takes its unsaved fields out of the count", () => {
    const view = page(
      <>
        {seat("workspace", <WorkspaceCard />)}
        {seat("notifications", <ChannelCard />)}
      </>,
    );
    type("name", "acme-2");
    type("channel", "#eng-all");
    expect(headSave()).toHaveTextContent("Save changes (2)");

    // The same tree with the second seat gone, so the first card stays mounted.
    view.rerender(
      <SettingsSaveProvider access={OWNER}>
        <div data-head>
          <SaveButton />
        </div>
        <SettingsDirtyBar />
        <>
          {seat("workspace", <WorkspaceCard />)}
          {null}
        </>
      </SettingsSaveProvider>,
    );

    expect(headSave()).toHaveTextContent("Save changes (1)");
    expect(screen.getByLabelText("name")).toHaveValue("acme-2");
  });
});
