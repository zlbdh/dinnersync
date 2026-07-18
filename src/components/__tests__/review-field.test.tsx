import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReviewValue } from "@/modules/recipe-import";

import { ReviewField } from "../review-field";

afterEach(cleanup);

function review<T>(value: T, status: ReviewValue<T>["status"] = "needs-review"): ReviewValue<T> {
  return {
    value,
    provenance: "inferred",
    evidence: null,
    inferenceReason: "The source does not state this explicitly.",
    confidence: 0.6,
    status,
  };
}

describe("ReviewField", () => {
  it("labels unresolved fields as needing review", () => {
    render(
      <ReviewField
        label="Instruction"
        kind="instruction"
        sourceText="Roast gently."
        review={review("Roast gently.")}
        onConfirm={() => undefined}
        onEdit={() => undefined}
      />,
    );

    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
  });

  it("uses a non-landmark field label and contextual action names", () => {
    render(
      <ReviewField
        label="Instruction"
        contextLabel="step 2 in Tomato Soup"
        kind="instruction"
        sourceText="Stir."
        review={review("Stir.")}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region", { name: /instruction/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Instruction" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Confirm Instruction in step 2 in Tomato Soup",
    })).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Edit Instruction in step 2 in Tomato Soup",
    })).toBeInTheDocument();
  });

  it("lets a keyboard user confirm a pending field", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReviewField
        label="Recipe name"
        kind="name"
        sourceText="Soup"
        review={review("Soup")}
        onConfirm={onConfirm}
        onEdit={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: /confirm recipe name/i });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("moves focus into the editor and returns it to Edit when cancelled", async () => {
    const user = userEvent.setup();
    render(
      <ReviewField
        label="Recipe name"
        kind="name"
        sourceText="Soup"
        review={review("Soup")}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit recipe name/i }));
    expect(screen.getByRole("textbox", { name: /new recipe name/i })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /edit recipe name/i })).toHaveFocus();
  });

  it("moves focus to Edit after a parent confirms and removes the confirm button", async () => {
    const user = userEvent.setup();
    const props = {
      label: "Recipe name",
      kind: "name" as const,
      sourceText: "Soup",
      onEdit: vi.fn(),
    };
    const onConfirm = vi.fn();
    const view = render(
      <ReviewField {...props} review={review("Soup")} onConfirm={onConfirm} />,
    );

    await user.click(screen.getByRole("button", { name: /confirm recipe name/i }));
    view.rerender(
      <ReviewField {...props} review={review("Soup", "confirmed")} onConfirm={onConfirm} />,
    );

    expect(screen.getByRole("button", { name: /edit recipe name/i })).toHaveFocus();
  });

  it("shows null source servings as not stated and confirms that decision explicitly", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ReviewField
        label="Source servings"
        kind="nullable-positive-number"
        sourceText="A pot of soup"
        review={review<number | null>(null)}
        onConfirm={onConfirm}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("Not stated in the source")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm not stated.*source servings/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("rejects zero and NaN-like positive-number edits before dispatch", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewField
        label="Duration minutes"
        kind="positive-number"
        sourceText="Cook 8 minutes"
        review={review(8)}
        onConfirm={vi.fn()}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit duration minutes/i }));
    const editor = screen.getByRole("spinbutton", { name: /new duration minutes/i });
    await user.clear(editor);
    await user.type(editor, "0");
    await user.click(screen.getByRole("button", { name: /save duration minutes/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/positive number/i);
    expect(editor).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(editor.getAttribute("aria-describedby")!))
      .toBe(screen.getByRole("alert"));
    expect(onEdit).not.toHaveBeenCalled();

    await user.clear(editor);
    await user.type(editor, "12");
    await user.click(screen.getByRole("button", { name: /save duration minutes/i }));
    expect(onEdit).toHaveBeenCalledWith(12, "User-confirmed correction");
  });

  it("uses a multiline instruction editor and enforces the domain text limit", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewField
        label="Instruction"
        kind="instruction"
        sourceText="Stir."
        review={review("Stir.")}
        onConfirm={vi.fn()}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit instruction/i }));
    const editor = screen.getByRole("textbox", { name: /new instruction/i });
    expect(editor.tagName).toBe("TEXTAREA");
    fireEvent.change(editor, { target: { value: "x".repeat(2_001) } });
    await user.click(screen.getByRole("button", { name: /save instruction/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/1 to 2000 characters/i);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("accepts zero Celsius but rejects temperatures outside the domain range", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewField
        label="Oven temperature C"
        kind="nullable-temperature"
        sourceText="Cool below freezing."
        review={review<number | null>(null)}
        onConfirm={vi.fn()}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit oven temperature/i }));
    const editor = screen.getByRole("spinbutton", { name: /new oven temperature/i });
    fireEvent.change(editor, { target: { value: "1001" } });
    await user.click(screen.getByRole("button", { name: /save oven temperature/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/-100 to 1000/i);
    fireEvent.change(editor, { target: { value: "0" } });
    await user.click(screen.getByRole("button", { name: /save oven temperature/i }));
    expect(onEdit).toHaveBeenCalledWith(0, "User-confirmed correction");
  });

  it("rejects dependency text that is not a bounded recipe identifier", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewField
        label="Dependencies"
        kind="string-list"
        sourceText="After prep."
        review={review(["prep"])}
        onConfirm={vi.fn()}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit dependencies/i }));
    const editor = screen.getByRole("textbox", { name: /new dependencies/i });
    fireEvent.change(editor, { target: { value: "invalid id with spaces" } });
    await user.click(screen.getByRole("button", { name: /save dependencies/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/valid step IDs/i);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("never dispatches a malformed enum value", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewField
        label="Step mode"
        kind="mode"
        sourceText="Cook"
        review={review<"active" | "passive">("active")}
        onConfirm={vi.fn()}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit step mode/i }));
    const select = screen.getByRole("combobox", { name: /new step mode/i });
    select.innerHTML += '<option value="steaming">Steaming</option>';
    await user.selectOptions(select, "steaming");
    await user.click(screen.getByRole("button", { name: /save step mode/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/listed option/i);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("validates resource ids before emitting a parsed resource list", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <ReviewField
        label="Resources"
        kind="resources"
        sourceText="Use burner 1"
        review={review([{ resourceId: "burner:1" }] as const)}
        onConfirm={vi.fn()}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit resources/i }));
    const input = screen.getByRole("textbox", { name: /new resources/i });
    await user.clear(input);
    await user.type(input, "hob:9");
    await user.click(screen.getByRole("button", { name: /save resources/i }));
    expect(onEdit).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "oven:1, burner:2");
    await user.click(screen.getByRole("button", { name: /save resources/i }));
    expect(onEdit).toHaveBeenCalledWith(
      [{ resourceId: "oven:1" }, { resourceId: "burner:2" }],
      "User-confirmed correction",
    );
  });
});
