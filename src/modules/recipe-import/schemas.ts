import type { Result } from "@/shared";
import { z } from "zod";

import { validateRecipeDraftEvidence } from "./evidence";
import type { RecipeDraft, ReviewIssue } from "./types";

const nonBlankText = z.string().min(1).refine((value) => value.trim().length > 0);
const positiveNumber = z.number().finite().positive();
const nullablePositiveNumber = positiveNumber.nullable();
const nullableTemperature = z.number().finite().min(-100).max(1_000).nullable();
const statusSchema = z.enum(["needs-review", "confirmed"]);
const aiStatusSchema = z.literal("needs-review");

const evidenceSpanSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  text: z.string().min(1),
});

const resourceRequirementSchema = z.strictObject({
  resourceId: z.enum(["cook:1", "oven:1", "burner:1", "burner:2"]),
});

function reviewValueSchema<T extends z.ZodType>(value: T, status: z.ZodType) {
  return z.strictObject({
    value,
    provenance: z.enum(["source", "inferred"]),
    evidence: evidenceSpanSchema.nullable(),
    inferenceReason: z.string().nullable(),
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
    id: nonBlankText,
    sourceText: nonBlankText,
    name: review(nonBlankText),
    quantity: review(nullablePositiveNumber),
    unit: review(nonBlankText.nullable()),
    foodState: review(z.enum(["raw", "cooked", "other"]).nullable()),
  });
  const step = z.strictObject({
    id: nonBlankText,
    sourceText: nonBlankText,
    instruction: review(nonBlankText),
    durationMinutes: review(positiveNumber),
    mode: review(z.enum(["active", "passive"])),
    dependsOn: review(z.array(nonBlankText)),
    resources: review(z.array(resourceRequirementSchema)),
    ovenOperation: review(z.enum(["preheat", "cook", "temperature-change"]).nullable()),
    ovenTemperatureC: review(nullableTemperature),
    isTerminal: review(z.boolean()),
  });
  return z.strictObject({
    id: nonBlankText,
    sourceText: nonBlankText,
    name: review(nonBlankText),
    sourceServings: review(nullablePositiveNumber),
    ingredients: z.array(ingredient),
    steps: z.array(step),
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
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((entry) => ({
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
  return validateRecipeDraftEvidence(draft);
}

export function parseAiRecipeDraft(value: unknown, expectedSourceText: string) {
  return parseWithSchema(aiRecipeDraftSchema, value, expectedSourceText);
}

export function parseRecipeDraft(value: unknown) {
  return parseWithSchema(recipeDraftSchema, value);
}
