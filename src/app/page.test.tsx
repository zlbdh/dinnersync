import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "./page";

describe("Home page", () => {
  it("renders the DinnerSync title", () => {
    render(<Page />);

    expect(
      screen.getByRole("heading", { level: 1, name: "DinnerSync" }),
    ).toBeInTheDocument();
  });
});
