import { describe, expect, it } from "vitest";

import {
  addMinutes,
  fromEpochMs,
  parseIsoInstant,
  toEpochMs,
} from "../index";

function expectInvalidInstant(input: unknown) {
  const result = parseIsoInstant(input);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toMatchObject({ code: "INVALID_ISO_INSTANT" });
  }
}

describe("parseIsoInstant", () => {
  it.each([
    "2026-07-18T12:34:56Z",
    "2026-07-18T12:34:56.1Z",
    "2026-07-18T12:34:56.12Z",
    "2026-07-18T12:34:56.123Z",
    "2024-02-29T23:59:59+08:00",
    "2026-07-18T12:34:56-07:30",
  ])("accepts a strict ISO instant: %s", (input) => {
    expect(parseIsoInstant(input)).toEqual({ ok: true, value: input });
  });

  it.each([
    "",
    "2026-07-18",
    "2026-07-18T12:34:56",
    "July 18 2026 12:34 UTC",
    "2026-07-18 12:34:56Z",
    "2026-07-18T12:34Z",
    "2026-07-18T12:34:56z",
    "2026-07-18T12:34:56,123Z",
    "2026-07-18T12:34:56.1234Z",
    "2026-07-18T12:34:56+0800",
    "2026-07-18T12:34:56Z\n",
  ])("rejects a non-strict or timezone-free value: %s", (input) => {
    expectInvalidInstant(input);
  });

  it.each([
    "2026-00-18T12:34:56Z",
    "2026-13-18T12:34:56Z",
    "2026-02-29T12:34:56Z",
    "2026-02-30T12:34:56Z",
    "2026-04-31T12:34:56Z",
    "2026-07-18T24:00:00Z",
    "2026-07-18T12:60:00Z",
    "2026-07-18T12:34:60Z",
    "2026-07-18T12:34:56+24:00",
    "2026-07-18T12:34:56+01:60",
  ])("rejects an invalid calendar, time, or offset: %s", (input) => {
    expectInvalidInstant(input);
  });

  it("rejects non-string runtime input without throwing", () => {
    expectInvalidInstant(null);
    expectInvalidInstant(1_721_303_696_000);
  });
});

describe("epoch conversion", () => {
  it("maps different offsets for one instant to the same epoch milliseconds", () => {
    expect(toEpochMs("2026-07-18T12:00:00Z")).toBe(
      toEpochMs("2026-07-18T20:00:00+08:00"),
    );
    expect(toEpochMs("2026-07-18T12:00:00Z")).toBe(
      toEpochMs("2026-07-18T05:00:00-07:00"),
    );
  });

  it("rejects an instant that did not pass the parser", () => {
    expect(() => toEpochMs("2026-02-30T12:00:00Z")).toThrow(TypeError);
  });

  it("emits one stable UTC Z representation", () => {
    expect(fromEpochMs(Date.UTC(2026, 6, 18, 12, 34, 56, 7))).toBe(
      "2026-07-18T12:34:56.007Z",
    );
  });

  it.each([
    ["0000-01-01T00:00:00.000Z", "0000-01-01T00:00:00.000Z"],
    ["2026-07-18T20:34:56.007+08:00", "2026-07-18T12:34:56.007Z"],
    ["9999-12-31T23:59:59.999Z", "9999-12-31T23:59:59.999Z"],
  ])("round-trips %s as canonical Z", (input, expected) => {
    const epochMs = toEpochMs(input);
    const canonical = fromEpochMs(epochMs);

    expect(canonical).toBe(expected);
    expect(parseIsoInstant(canonical).ok).toBe(true);
    expect(toEpochMs(canonical)).toBe(epochMs);
  });

  it("rejects epochs immediately outside the canonical four-digit range", () => {
    const minimum = toEpochMs("0000-01-01T00:00:00.000Z");
    const maximum = toEpochMs("9999-12-31T23:59:59.999Z");

    expect(() => fromEpochMs(minimum - 1)).toThrow(RangeError);
    expect(() => fromEpochMs(maximum + 1)).toThrow(RangeError);
  });

  it.each([
    "0000-01-01T00:00:00+23:59",
    "9999-12-31T23:59:59.999-23:59",
  ])("rejects a local four-digit value whose UTC instant is out of range: %s", (input) => {
    expectInvalidInstant(input);
    expect(() => toEpochMs(input)).toThrow(TypeError);
  });

  it("rejects non-finite, fractional, unsafe, or out-of-range epochs", () => {
    expect(() => fromEpochMs(Number.NaN)).toThrow(TypeError);
    expect(() => fromEpochMs(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => fromEpochMs(1.5)).toThrow(RangeError);
    expect(() => fromEpochMs(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => fromEpochMs(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });
});

describe("addMinutes", () => {
  it("crosses hour and day boundaries and normalizes to UTC", () => {
    expect(addMinutes("2026-07-18T23:45:00Z", 30)).toBe(
      "2026-07-19T00:15:00.000Z",
    );
    expect(addMinutes("2026-07-18T20:45:00+08:00", 30)).toBe(
      "2026-07-18T13:15:00.000Z",
    );
  });

  it("supports negative integer minutes", () => {
    expect(addMinutes("2026-07-19T00:15:00Z", -30)).toBe(
      "2026-07-18T23:45:00.000Z",
    );
  });

  it("stays canonical inside the four-digit boundaries", () => {
    expect(addMinutes("0000-01-01T00:00:00.000Z", 1)).toBe(
      "0000-01-01T00:01:00.000Z",
    );
    expect(addMinutes("9999-12-31T23:59:59.999Z", -1)).toBe(
      "9999-12-31T23:58:59.999Z",
    );
  });

  it("rejects arithmetic that crosses the four-digit boundaries", () => {
    expect(() => addMinutes("0000-01-01T00:00:00.000Z", -1)).toThrow(
      RangeError,
    );
    expect(() => addMinutes("9999-12-31T23:59:59.999Z", 1)).toThrow(
      RangeError,
    );
  });

  it("rejects fractional, non-finite, and unsafe minute counts", () => {
    expect(() => addMinutes("2026-07-18T12:00:00Z", 0.5)).toThrow(
      RangeError,
    );
    expect(() => addMinutes("2026-07-18T12:00:00Z", Number.NaN)).toThrow(
      TypeError,
    );
    expect(() =>
      addMinutes("2026-07-18T12:00:00Z", Number.MAX_SAFE_INTEGER + 1),
    ).toThrow(RangeError);
  });
});
