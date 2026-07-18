import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SetupScreen,
  type SetupFormValues,
} from "../setup-screen";

afterEach(cleanup);

const EMPTY_VALUES: SetupFormValues = {
  recipeTexts: ["", "", ""],
  diners: 2,
  availableTime: "18:00",
  serveTime: "19:00",
  targetKcalPerPerson: "",
  burners: 2,
  notes: "",
};

const COMPLETE_VALUES: SetupFormValues = {
  ...EMPTY_VALUES,
  recipeTexts: ["Chicken recipe", "", ""],
};

function renderSetup(
  overrides: Partial<React.ComponentProps<typeof SetupScreen>> = {},
) {
  const props: React.ComponentProps<typeof SetupScreen> = {
    mode: "hosted",
    values: EMPTY_VALUES,
    consentToSend: false,
    onModeChange: vi.fn(),
    onValuesChange: vi.fn(),
    onConsentChange: vi.fn(),
    onLoadDemo: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<SetupScreen {...props} />);
  return props;
}

describe("SetupScreen", () => {
  it("presents the three-recipe service setup and fixed kitchen limits", () => {
    renderSetup();

    expect(screen.getByRole("heading", { name: /set the table/i })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: /recipe \d/i })).toHaveLength(3);
    expect(screen.getByRole("spinbutton", { name: /diners/i })).toHaveValue(2);
    expect(screen.getByLabelText(/available from/i)).toHaveValue("18:00");
    expect(screen.getByLabelText(/^dinner lands$/i, { selector: "input" })).toHaveValue("19:00");
    expect(screen.getByRole("spinbutton", { name: /target kcal/i })).toHaveValue(null);
    expect(screen.getByText(/^Fixed 5 minute landing window$/i)).toBeInTheDocument();
    expect(screen.getByText(/1 cook/i)).toBeInTheDocument();
    expect(screen.getByText(/1 oven/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /burners/i })).toHaveValue("2");
    expect(screen.getByRole("textbox", { name: /diet.*allergy notes/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build my service plan/i })).not.toBeInTheDocument();
  });

  it("loads the hosted fixture in one action without sending browser data", async () => {
    const user = userEvent.setup();
    const props = renderSetup();

    expect(screen.getByText(/no data leaves this browser/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try the 650 kcal demo" }));

    expect(props.onLoadDemo).toHaveBeenCalledOnce();
  });

  it("keeps mode selection reachable by keyboard", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.tab();
    expect(screen.getByRole("radio", { name: /hosted demo/i })).toHaveFocus();
  });

  it("exposes the service preview as readable tracks and a landing time", () => {
    renderSetup();

    const tracks = screen.getByRole("list", { name: /service tracks/i });
    expect(tracks).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /main.*cook/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /vegetables.*oven/i })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /starch.*burner/i })).toBeInTheDocument();
    expect(screen.getByText("19:00", { selector: "time" })).toHaveAttribute(
      "dateTime",
      "19:00",
    );
  });

  it("requires explicit consent before Local AI can submit recipe text", async () => {
    const user = userEvent.setup();
    const onConsentChange = vi.fn();
    renderSetup({
      mode: "local",
      values: COMPLETE_VALUES,
      consentToSend: false,
      onConsentChange,
    });

    expect(
      screen.getByText(/recipe text is sent to OpenAI through your logged-in Codex/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /build my service plan/i })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /send these recipes to OpenAI/i }));
    expect(onConsentChange).toHaveBeenCalledWith(true);
  });

  it("submits one to three non-empty recipes after Local AI consent", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderSetup({
      mode: "local",
      values: COMPLETE_VALUES,
      consentToSend: true,
      onSubmit,
    });

    const submit = screen.getByRole("button", { name: /build my service plan/i });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(["Chicken recipe"]);
  });

  it("places the single Local AI action before the recipe fields", () => {
    renderSetup({ mode: "local", values: COMPLETE_VALUES });

    const action = screen.getByRole("button", { name: /build my service plan/i });
    const recipes = screen.getByRole("group", { name: /up to three recipes/i });
    expect(
      action.compareDocumentPosition(recipes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /650 kcal demo/i })).not.toBeInTheDocument();
  });

  it("filters blank recipe slots without changing the submitted source text", () => {
    const onSubmit = vi.fn();
    const original = "\n  Chicken recipe with source spacing  \n";
    renderSetup({
      mode: "local",
      values: { ...COMPLETE_VALUES, recipeTexts: [original, "   ", ""] },
      consentToSend: true,
      onSubmit,
    });

    fireEvent.submit(document.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledWith([original]);
  });

  it("does not submit an empty Local AI form even with consent", () => {
    renderSetup({ mode: "local", consentToSend: true });

    expect(screen.getByRole("button", { name: /build my service plan/i })).toBeDisabled();
  });

  it("rejects direct form submission without Local AI consent", () => {
    const onSubmit = vi.fn();
    renderSetup({ mode: "local", values: COMPLETE_VALUES, onSubmit });

    fireEvent.submit(document.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a same-day service time before availability and links the error", () => {
    const onSubmit = vi.fn();
    renderSetup({
      mode: "local",
      consentToSend: true,
      values: { ...COMPLETE_VALUES, availableTime: "19:00", serveTime: "18:00" },
      onSubmit,
    });

    const availableInput = screen.getByLabelText(/available from/i);
    const serveInput = screen.getByLabelText(/^dinner lands$/i, { selector: "input" });
    expect(availableInput).toHaveAttribute("aria-invalid", "false");
    expect(serveInput).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(serveInput.getAttribute("aria-describedby")!))
      .toHaveTextContent(/must land after available time/i);
    fireEvent.submit(document.querySelector("form")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("links an empty available time only to the available field", () => {
    renderSetup({
      mode: "local",
      consentToSend: true,
      values: { ...COMPLETE_VALUES, availableTime: "", serveTime: "19:00" },
    });

    const available = screen.getByLabelText(/available from/i);
    const serve = screen.getByLabelText(/^dinner lands$/i, { selector: "input" });
    expect(available).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(available.getAttribute("aria-describedby")!))
      .toHaveTextContent(/choose when cooking can begin/i);
    expect(serve).toHaveAttribute("aria-invalid", "false");
  });

  it("links an empty landing time only to the landing field", () => {
    renderSetup({
      mode: "local",
      consentToSend: true,
      values: { ...COMPLETE_VALUES, availableTime: "18:00", serveTime: "" },
    });

    const available = screen.getByLabelText(/available from/i);
    const serve = screen.getByLabelText(/^dinner lands$/i, { selector: "input" });
    expect(available).toHaveAttribute("aria-invalid", "false");
    expect(serve).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(serve.getAttribute("aria-describedby")!))
      .toHaveTextContent(/choose when dinner should land/i);
  });

  it("links an invalid diner count to its recovery message", () => {
    renderSetup({
      mode: "local",
      consentToSend: true,
      values: { ...COMPLETE_VALUES, diners: 0 },
    });

    const diners = screen.getByRole("spinbutton", { name: /diners/i });
    expect(diners).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(diners.getAttribute("aria-describedby")!))
      .toHaveTextContent(/between 1 and 12/i);
  });

  it.each(["0", "-25"])(
    "rejects an invalid optional kcal target of %s",
    (targetKcalPerPerson) => {
      const onSubmit = vi.fn();
      renderSetup({
        mode: "local",
        consentToSend: true,
        values: { ...COMPLETE_VALUES, targetKcalPerPerson },
        onSubmit,
      });

      const target = screen.getByRole("spinbutton", { name: /target kcal/i });
      expect(target).toHaveAttribute("aria-invalid", "true");
      expect(document.getElementById(target.getAttribute("aria-describedby")!))
        .toHaveTextContent(/positive number or leave it blank/i);
      fireEvent.submit(document.querySelector("form")!);
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("associates the calorie helper copy with its optional input", () => {
    renderSetup();

    const kcalInput = screen.getByRole("spinbutton", { name: /target kcal/i });
    const descriptionId = kcalInput.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(/optional.*estimate/i);
  });
});
