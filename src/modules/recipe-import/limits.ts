export const MAX_RECIPE_COUNT = 3;
export const MAX_RECIPE_CHARS = 12_000;
export const MAX_TOTAL_RECIPE_CHARS = 24_000;

export const MAX_IDENTIFIER_CHARS = 96;
export const MAX_NAME_CHARS = 256;
export const MAX_UNIT_CHARS = 64;
export const MAX_INSTRUCTION_CHARS = 2_000;
export const MAX_INFERENCE_REASON_CHARS = 600;
export const MAX_INGREDIENTS = 64;
export const MAX_STEPS = 128;
export const MAX_DEPENDENCIES = 128;
export const MAX_RESOURCES = 4;
export const MAX_REVIEW_ISSUES = 128;

const MAX_JSON_ARRAY_ITEMS = 128;
const MAX_JSON_OBJECT_KEYS = 32;
const MAX_JSON_KEY_CHARS = 128;
const MAX_JSON_DEPTH = 20;
const MAX_JSON_NODES = 25_000;

export type OutputBoundaryViolation = {
  path: string;
  message: string;
};

export function findOutputBoundaryViolation(value: unknown): OutputBoundaryViolation | undefined {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: "$", depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_JSON_NODES) return violation(current.path, "Output has too many values.");
    if (current.depth > MAX_JSON_DEPTH) return violation(current.path, "Output is nested too deeply.");
    if (typeof current.value === "string") {
      if (current.value.length > MAX_RECIPE_CHARS) {
        return violation(current.path, "Output contains an oversized string.");
      }
      continue;
    }
    if (current.value === null || typeof current.value === "boolean") continue;
    if (typeof current.value === "number" && Number.isFinite(current.value)) continue;
    if (typeof current.value !== "object") {
      return violation(current.path, "Output contains a non-JSON value.");
    }
    if (seen.has(current.value)) return violation(current.path, "Output contains a cycle.");
    seen.add(current.value);
    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_JSON_ARRAY_ITEMS) {
        return violation(current.path, "Output array exceeds the item limit.");
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) {
      return violation(current.path, "Output contains a non-JSON object.");
    }
    let keys = 0;
    for (const key in current.value) {
      if (!Object.hasOwn(current.value, key)) continue;
      keys += 1;
      if (keys > MAX_JSON_OBJECT_KEYS) {
        return violation(current.path, "Output object has too many properties.");
      }
      if (key.length > MAX_JSON_KEY_CHARS) {
        return violation(current.path, "Output contains an oversized property name.");
      }
      pending.push({
        value: (current.value as Record<string, unknown>)[key],
        path: `${current.path}.${key}`,
        depth: current.depth + 1,
      });
    }
  }
  return undefined;
}

function violation(path: string, message: string): OutputBoundaryViolation {
  return { path, message };
}
