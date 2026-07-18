import type { Result } from "@/shared";
import { z } from "zod";

import { validateRecipeDraftEvidence } from "./evidence";
import {
  MAX_DEPENDENCIES,
  MAX_IDENTIFIER_CHARS,
  MAX_INFERENCE_REASON_CHARS,
  MAX_INGREDIENTS,
  MAX_INSTRUCTION_CHARS,
  MAX_NAME_CHARS,
  MAX_RECIPE_CHARS,
  MAX_RESOURCES,
  MAX_REVIEW_ISSUES,
  MAX_STEPS,
  MAX_UNIT_CHARS,
  findOutputBoundaryViolation,
} from "./limits";
import type { RecipeDraft, ReviewIssue } from "./types";

const boundedText = (max: number) => z.string().max(max);
const nonBlankText = (max: number) => boundedText(max)
  .min(1)
  .refine((value) => value.trim().length > 0);
const identifier = nonBlankText(MAX_IDENTIFIER_CHARS)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const sourceText = nonBlankText(MAX_RECIPE_CHARS);
const positiveNumber = z.number().finite().positive();
const nullablePositiveNumber = positiveNumber.nullable();
const nullableTemperature = z.number().finite().min(-100).max(1_000).nullable();
const statusSchema = z.enum(["needs-review", "confirmed"]);
const aiStatusSchema = z.literal("needs-review");

const evidenceSpanSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: boundedText(MAX_RECIPE_CHARS).min(1),
});

const resourceRequirementSchema = z.strictObject({
  resourceId: z.enum(["cook:1", "oven:1", "burner:1", "burner:2"]),
});

function reviewValueSchema<T extends z.ZodType>(value: T, status: z.ZodType) {
  return z.strictObject({
    value,
    provenance: z.enum(["source", "inferred"]),
    evidence: evidenceSpanSchema.nullable(),
    inferenceReason: boundedText(MAX_INFERENCE_REASON_CHARS).nullable(),
    confidence: z.number().finite().min(0).max(1),
    status,
  }).superRefine((review, context) => {
    if (review.provenance === "source") {
      if (review.evidence === null) {
        context.addIssue({ code: "custom", path: ["evidence"], message: "Source evidence is required." });
      }
      if (review.inferenceReason !== null) {
        context.addIssue({
          code: "custom",
          path: ["inferenceReason"],
          message: "Source values cannot have an inference reason.",
        });
      }
    } else {
      if (review.evidence !== null) {
        context.addIssue({ code: "custom", path: ["evidence"], message: "Inferred evidence is forbidden." });
      }
      if (review.inferenceReason === null || review.inferenceReason.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["inferenceReason"],
          message: "An inference reason is required.",
        });
      }
    }
  });
}

function createRecipeDraftSchema(status: z.ZodType) {
  const review = <T extends z.ZodType>(value: T) => reviewValueSchema(value, status);
  const ingredient = z.strictObject({
    id: identifier,
    sourceText,
    name: review(nonBlankText(MAX_NAME_CHARS)),
    quantity: review(nullablePositiveNumber),
    unit: review(nonBlankText(MAX_UNIT_CHARS).nullable()),
    foodState: review(z.enum(["raw", "cooked", "other"]).nullable()),
  });
  const step = z.strictObject({
    id: identifier,
    sourceText,
    instruction: review(nonBlankText(MAX_INSTRUCTION_CHARS)),
    durationMinutes: review(positiveNumber),
    mode: review(z.enum(["active", "passive"])),
    dependsOn: review(z.array(identifier).max(MAX_DEPENDENCIES)),
    resources: review(z.array(resourceRequirementSchema).max(MAX_RESOURCES)),
    ovenOperation: review(z.enum(["preheat", "cook", "temperature-change"]).nullable()),
    ovenTemperatureC: review(nullableTemperature),
    isTerminal: review(z.boolean()),
  });
  return z.strictObject({
    id: identifier,
    sourceText,
    name: review(nonBlankText(MAX_NAME_CHARS)),
    sourceServings: review(nullablePositiveNumber),
    ingredients: z.array(ingredient).max(MAX_INGREDIENTS),
    steps: z.array(step).max(MAX_STEPS),
  });
}

export const aiRecipeDraftSchema = createRecipeDraftSchema(aiStatusSchema);
export const recipeDraftSchema = createRecipeDraftSchema(statusSchema);
export const aiRecipeDraftJsonSchema = z.toJSONSchema(aiRecipeDraftSchema);

function zodPath(path: PropertyKey[]) {
  if (path.length === 0) return "$";
  return path.reduce<string>((result, part) => {
    if (typeof part === "number") return `${result}[${part}]`;
    return result === "" ? String(part) : `${result}.${String(part)}`;
  }, "");
}

function parseWithSchema(
  schema: typeof aiRecipeDraftSchema | typeof recipeDraftSchema,
  value: unknown,
  expectedSourceText?: string,
): Result<RecipeDraft, ReviewIssue[]> {
  const boundary = findOutputBoundaryViolation(value);
  if (boundary) {
    return {
      ok: false,
      error: [{
        path: boundary.path,
        code: "OUTPUT_BOUNDARY_EXCEEDED",
        message: boundary.message,
      }],
    };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.slice(0, MAX_REVIEW_ISSUES).map((entry) => ({
        path: zodPath(entry.path),
        code: "SCHEMA_INVALID",
        message: entry.message,
      })),
    };
  }
  const draft = parsed.data as RecipeDraft;
  if (expectedSourceText !== undefined && draft.sourceText !== expectedSourceText) {
    return {
      ok: false,
      error: [{
        path: "sourceText",
        code: "SOURCE_TEXT_MISMATCH",
        message: "Draft source text must exactly match the submitted recipe.",
      }],
    };
  }
  const evidence = validateRecipeDraftEvidence(draft);
  return evidence.ok
    ? evidence
    : { ok: false, error: evidence.error.slice(0, MAX_REVIEW_ISSUES) };
}

export function parseAiRecipeDraft(value: unknown, expectedSourceText: string) {
  return parseWithSchema(aiRecipeDraftSchema, value, expectedSourceText);
}

export function parseRecipeDraft(value: unknown) {
  return parseWithSchema(recipeDraftSchema, value);
}
