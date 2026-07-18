import type { DinnerPlanSettings } from "@/modules/dinner-planner";

const INVALID_MESSAGE = "Check the dinner settings and use same-day times in order.";
const WALL_CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export type SetupSettingsInput = {
  diners: number;
  availableTime: string;
  serveTime: string;
  targetKcalPerPerson: string;
  burners: number;
};

export type SetupSettingsResult =
  | { ok: true; value: DinnerPlanSettings }
  | {
    ok: false;
    code: "INVALID_SETUP_SETTINGS";
    message: string;
  };

function invalid(): SetupSettingsResult {
  return {
    ok: false,
    code: "INVALID_SETUP_SETTINGS",
    message: INVALID_MESSAGE,
  };
}

function parseWallClock(value: string) {
  if (!WALL_CLOCK.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

function sameDayInstant(today: Date, hour: number, minute: number) {
  const value = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    hour,
    minute,
    0,
    0,
  );
  if (Number.isNaN(value.getTime())
    || value.getFullYear() !== today.getFullYear()
    || value.getMonth() !== today.getMonth()
    || value.getDate() !== today.getDate()
    || value.getHours() !== hour
    || value.getMinutes() !== minute) return undefined;
  return value.toISOString();
}

export function setupValuesToSettings(
  values: SetupSettingsInput,
  today: Date = new Date(),
): SetupSettingsResult {
  if (Number.isNaN(today.getTime())
    || !Number.isInteger(values.diners)
    || values.diners < 1
    || values.diners > 12
    || (values.burners !== 1 && values.burners !== 2)) return invalid();

  const available = parseWallClock(values.availableTime);
  const serve = parseWallClock(values.serveTime);
  if (!available || !serve || serve.totalMinutes <= available.totalMinutes) return invalid();

  const targetText = values.targetKcalPerPerson.trim();
  const targetKcal = targetText === "" ? null : Number(targetText);
  if (targetKcal !== null && (!Number.isFinite(targetKcal) || targetKcal <= 0)) {
    return invalid();
  }

  const availableFrom = sameDayInstant(today, available.hour, available.minute);
  const serveAt = sameDayInstant(today, serve.hour, serve.minute);
  if (!availableFrom || !serveAt) return invalid();

  return {
    ok: true,
    value: {
      diners: values.diners,
      availableFrom,
      serveAt,
      targetKcalPerPerson: targetKcal,
      kitchen: { cooks: 1, ovens: 1, burners: values.burners },
      serveToleranceMinutes: 5,
    },
  };
}
