import { describe, expect, it } from "vitest";

import { setupValuesToSettings } from "../setup-settings";

const validValues = {
  diners: 4,
  availableTime: "18:05",
  serveTime: "19:10",
  targetKcalPerPerson: "650",
  burners: 2 as const,
};

describe("setupValuesToSettings", () => {
  it("maps same-day local wall clocks to ISO instants and fixed resources", () => {
    const today = new Date(2026, 6, 19, 8, 30, 45, 123);

    const result = setupValuesToSettings(validValues, today);

    expect(result).toEqual({
      ok: true,
      value: {
        diners: 4,
        availableFrom: new Date(2026, 6, 19, 18, 5).toISOString(),
        serveAt: new Date(2026, 6, 19, 19, 10).toISOString(),
        targetKcalPerPerson: 650,
        kitchen: { cooks: 1, ovens: 1, burners: 2 },
        serveToleranceMinutes: 5,
      },
    });
  });

  it("maps a blank calorie target to null", () => {
    const result = setupValuesToSettings(
      { ...validValues, targetKcalPerPerson: "   " },
      new Date(2026, 0, 2),
    );

    expect(result.ok && result.value.targetKcalPerPerson).toBeNull();
  });

  it.each([
    ["invalid date seed", validValues, new Date(Number.NaN)],
    ["blank available time", { ...validValues, availableTime: "" }, new Date(2026, 0, 2)],
    ["invalid serve time", { ...validValues, serveTime: "24:00" }, new Date(2026, 0, 2)],
    ["equal times", { ...validValues, serveTime: "18:05" }, new Date(2026, 0, 2)],
    ["reverse times", { ...validValues, serveTime: "17:59" }, new Date(2026, 0, 2)],
    ["fractional diners", { ...validValues, diners: 2.5 }, new Date(2026, 0, 2)],
    ["too many diners", { ...validValues, diners: 13 }, new Date(2026, 0, 2)],
    ["invalid burners", { ...validValues, burners: 3 }, new Date(2026, 0, 2)],
    ["invalid calorie target", { ...validValues, targetKcalPerPerson: "NaN" }, new Date(2026, 0, 2)],
  ])("rejects %s without producing Invalid Date", (_label, values, today) => {
    const result = setupValuesToSettings(values, today);

    expect(result).toEqual({
      ok: false,
      code: "INVALID_SETUP_SETTINGS",
      message: "Check the dinner settings and use same-day times in order.",
    });
    expect(JSON.stringify(result)).not.toContain("Invalid Date");
  });
});
