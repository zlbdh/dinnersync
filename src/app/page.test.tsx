import { readFileSync } from "node:fs";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_REVIEW_STATES, DEMO_SOURCE_RECIPES } from "@/modules/demo";

import Page from "./page";

function contrastRatio(first: string, second: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[\da-f]{2}/gi)!.map((entry) => {
      const value = Number.parseInt(entry, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Home page", () => {
  it("renders the DinnerSync title", () => {
    render(<Page />);

    expect(
      screen.getByRole("heading", { level: 1, name: "DinnerSync" }),
    ).toBeInTheDocument();
  });

  it("keeps focus treatment visible and burner controls touch sized", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/--focus:\s*#[\da-f]{6}/i);
    const color = (name: string) => css.match(
      new RegExp(`--${name}:\\s*(#[\\da-f]{6})`, "i"),
    )![1];
    const inputFocus = css.match(
      /input:focus,\s*select:focus,\s*textarea:focus\s*\{([^}]*)\}/,
    )![1];

    expect(contrastRatio(color("focus"), color("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color("focus"), color("cream"))).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/);
    expect(css).toMatch(/\.mode-option input:focus-visible \+ span\s*\{[^}]*outline:/);
    expect(inputFocus).not.toMatch(/outline:\s*none/);
    expect(css).toMatch(/\.resource-row select\s*\{[^}]*min-height:\s*2\.75rem/);
  });

  it("enters review from hosted fixtures without requesting Local AI", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    const fixtureBefore = JSON.stringify({
      recipes: DEMO_SOURCE_RECIPES,
      reviews: DEMO_REVIEW_STATES,
    });
    vi.stubGlobal("fetch", fetchSpy);
    render(<Page />);

    await user.click(screen.getByRole("button", { name: "Try the 650 kcal demo" }));

    expect(screen.getByRole("heading", { name: "Demo dinner loaded." })).toBeInTheDocument();
    expect(screen.getByText(/3 pre-generated, pre-reviewed fixtures/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /back to setup/i }));
    await user.click(screen.getByRole("radio", { name: /local ai/i }));
    expect(screen.getByRole("textbox", { name: /recipe 1/i })).toHaveValue("");
    expect(screen.getByRole("spinbutton", { name: /target kcal/i })).toHaveValue(null);
    expect(screen.getByRole("checkbox", { name: /send these recipes/i })).not.toBeChecked();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify({
      recipes: DEMO_SOURCE_RECIPES,
      reviews: DEMO_REVIEW_STATES,
    })).toBe(fixtureBefore);
  });

  it("keeps unparsed Local AI text in setup and clears it between modes", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<Page />);

    await user.click(screen.getByRole("radio", { name: /local ai/i }));
    const firstRecipe = screen.getByRole("textbox", { name: /recipe 1/i });
    await user.type(firstRecipe, "One complete recipe");
    await user.click(screen.getByRole("checkbox", { name: /send these recipes/i }));
    await user.click(screen.getByRole("button", { name: /build my service plan/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/not parsed yet/i);
    expect(screen.getByRole("heading", { name: /set the table/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /hosted demo/i }));
    await user.click(screen.getByRole("radio", { name: /local ai/i }));
    expect(screen.getByRole("textbox", { name: /recipe 1/i })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: /send these recipes/i })).not.toBeChecked();
  });
});
