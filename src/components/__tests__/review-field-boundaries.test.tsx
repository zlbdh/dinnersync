import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_DEPENDENCIES,
  MAX_NAME_CHARS,
  MAX_RESOURCES,
  MAX_UNIT_CHARS,
  type ReviewValue,
} from "@/modules/recipe-import";

import { ReviewField, type ReviewFieldKind } from "../review-field";

afterEach(cleanup);

function review(value: unknown): ReviewValue<unknown> {
  return {
    value,
    provenance: "inferred",
    evidence: null,
    inferenceReason: "Fixture",
    confidence: 0.5,
    status: "confirmed",
  };
}

async function editAndSave(kind: ReviewFieldKind, label: string, value: unknown, raw: string) {
  const user = userEvent.setup();
  const onEdit = vi.fn();
  render(
    <ReviewField
      label={label}
      kind={kind}
      sourceText="Fixture"
      review={review(value)}
      onConfirm={vi.fn()}
      onEdit={onEdit}
    />,
  );
  await user.click(screen.getByRole("button", { name: `Edit ${label}` }));
  const editor = screen.getByLabelText(`New ${label}`);
  fireEvent.change(editor, { target: { value: raw } });
  await user.click(screen.getByRole("button", { name: `Save ${label}` }));
  return onEdit;
}

describe("ReviewField schema boundaries", () => {
  it("accepts the exact recipe-name limit and rejects one extra character", async () => {
    const accepted = await editAndSave("name", "Recipe name", "Old", "n".repeat(MAX_NAME_CHARS));
    expect(accepted).toHaveBeenCalledWith("n".repeat(MAX_NAME_CHARS), "User-confirmed correction");
    cleanup();
    const rejected = await editAndSave("name", "Recipe name", "Old", "n".repeat(MAX_NAME_CHARS + 1));
    expect(rejected).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${MAX_NAME_CHARS}`);
  });

  it("uses the shared nullable unit limit", async () => {
    const rejected = await editAndSave(
      "nullable-text",
      "Unit",
      "g",
      "u".repeat(MAX_UNIT_CHARS + 1),
    );
    expect(rejected).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${MAX_UNIT_CHARS}`);
  });

  it("rejects dependency lists above the shared maximum", async () => {
    const raw = Array.from({ length: MAX_DEPENDENCIES + 1 }, (_, index) => `step-${index}`).join(",");
    const rejected = await editAndSave("string-list", "Dependencies", [], raw);
    expect(rejected).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${MAX_DEPENDENCIES}`);
  });

  it("rejects resource lists above the shared maximum", async () => {
    const ids = ["cook:1", "oven:1", "burner:1", "burner:2"];
    const raw = Array.from({ length: MAX_RESOURCES + 1 }, (_, index) => ids[index % ids.length]).join(",");
    const rejected = await editAndSave("resources", "Resources", [], raw);
    expect(rejected).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(`${MAX_RESOURCES}`);
  });
});
