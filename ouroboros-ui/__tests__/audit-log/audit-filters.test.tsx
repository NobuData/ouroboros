import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuditFilters } from "@/app/audit-log/audit-filters";
import { type AuditFilterForm, DAY_INVALID, EMPTY_FORM, PLANE_INVALID } from "@/app/audit-log/view";

/**
 * The filter form (BS.5, [#495](https://github.com/NobuData/ouroboros/issues/495)): it holds
 * nothing — every edit is handed up whole — and Enter applies.
 */

/**
 * The form with spies for its three callbacks.
 *
 * @param form The form to draw.
 * @param errors The errors to draw.
 * @returns The spies.
 */
function mount(form: AuditFilterForm = EMPTY_FORM, errors = {}) {
  const onChange = vi.fn<(form: AuditFilterForm) => void>();
  const onApply = vi.fn();
  const onClear = vi.fn();

  render(
    <AuditFilters
      actors={[{ value: "id:user-ken", label: "Ken" }]}
      errors={errors}
      form={form}
      id="filters"
      onApply={onApply}
      onChange={onChange}
      onClear={onClear}
    />,
  );

  return { onChange, onApply, onClear };
}

describe("the filter form", () => {
  it("hands every edit up as the whole form", () => {
    const { onChange } = mount({ ...EMPTY_FORM, plane: "policy" });

    fireEvent.change(screen.getByLabelText("Actor kind"), { target: { value: "bot" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FORM, plane: "policy", actorKind: "bot" });

    fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "id:user-ken" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FORM, plane: "policy", actor: "id:user-ken" });

    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "pr:509" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_FORM, plane: "policy", ref: "pr:509" });
  });

  it("applies on submit and clears on its button, without submitting", () => {
    const { onApply, onClear } = mount();

    fireEvent.submit(screen.getByRole("form"));
    expect(onApply).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("draws each error at its field", () => {
    mount(EMPTY_FORM, { from: DAY_INVALID, plane: PLANE_INVALID });

    expect(screen.getByLabelText("From (UTC day)").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Plane or action").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Reference").getAttribute("aria-invalid")).not.toBe("true");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([DAY_INVALID, PLANE_INVALID]);
  });

  it("carries the id the toggle controls", () => {
    mount();

    expect(screen.getByRole("form").id).toBe("filters");
  });
});
