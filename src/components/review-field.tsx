"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  isRecipeIdentifier,
  MAX_DEPENDENCIES,
  MAX_INSTRUCTION_CHARS,
  MAX_NAME_CHARS,
  MAX_RESOURCES,
  MAX_UNIT_CHARS,
  type ReviewValue,
} from "@/modules/recipe-import";
import { isResourceId } from "@/shared";

import { ReviewEvidence } from "./review-evidence";
import { Button } from "./ui/button";

export type ReviewFieldKind =
  | "name"
  | "instruction"
  | "nullable-text"
  | "positive-number"
  | "nullable-positive-number"
  | "food-state"
  | "mode"
  | "string-list"
  | "resources"
  | "oven-operation"
  | "nullable-temperature"
  | "boolean";

export type ReviewFieldProps = {
  label: string;
  contextLabel?: string;
  kind: ReviewFieldKind;
  sourceText: string;
  review: ReviewValue<unknown>;
  displayValue?: string;
  onConfirm: () => void;
  onEdit: (value: unknown, reason: string) => void;
};

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function editorText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => typeof entry === "string"
      ? entry
      : (entry as { resourceId?: string }).resourceId ?? "").join(", ");
  }
  return String(value);
}

function displayText(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not stated in the source";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return editorText(value) || "None";
  return String(value);
}

function positive(raw: string, nullable: boolean): Parsed {
  if (nullable && raw.trim() === "") return { ok: true, value: null };
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? { ok: true, value }
    : { ok: false, message: "Enter a positive number." };
}

function listed(raw: string, values: readonly string[], nullable = false): Parsed {
  if (nullable && raw === "") return { ok: true, value: null };
  return values.includes(raw)
    ? { ok: true, value: raw }
    : { ok: false, message: "Choose a listed option." };
}

function boundedText(raw: string, max: number, nullable = false): Parsed {
  const value = raw.trim();
  if (nullable && value === "") return { ok: true, value: null };
  return value !== "" && value.length <= max
    ? { ok: true, value }
    : { ok: false, message: `Enter 1 to ${max} characters.` };
}

function parseEdit(kind: ReviewFieldKind, raw: string): Parsed {
  if (kind === "positive-number") return positive(raw, false);
  if (kind === "nullable-positive-number") return positive(raw, true);
  if (kind === "nullable-temperature") {
    if (raw.trim() === "") return { ok: true, value: null };
    const value = Number(raw);
    return Number.isFinite(value) && value >= -100 && value <= 1_000
      ? { ok: true, value }
      : { ok: false, message: "Enter a temperature from -100 to 1000 C, or leave it blank." };
  }
  if (kind === "mode") return listed(raw, ["active", "passive"]);
  if (kind === "food-state") return listed(raw, ["raw", "cooked", "other"], true);
  if (kind === "oven-operation") {
    return listed(raw, ["preheat", "cook", "temperature-change"], true);
  }
  if (kind === "boolean") {
    return raw === "true" || raw === "false"
      ? { ok: true, value: raw === "true" }
      : { ok: false, message: "Choose a listed option." };
  }
  if (kind === "string-list") {
    const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length > MAX_DEPENDENCIES || !values.every(isRecipeIdentifier)) {
      return { ok: false, message: `Use up to ${MAX_DEPENDENCIES} valid step IDs.` };
    }
    return { ok: true, value: values };
  }
  if (kind === "resources") {
    const values = raw.split(",").map((item) => item.trim()).filter(Boolean);
    if (values.length > MAX_RESOURCES || !values.every(isResourceId)) {
      return { ok: false, message: `Use up to ${MAX_RESOURCES} of cook:1, oven:1, burner:1, or burner:2.` };
    }
    return { ok: true, value: values.map((resourceId) => ({ resourceId })) };
  }
  if (kind === "nullable-text") return boundedText(raw, MAX_UNIT_CHARS, true);
  if (kind === "name") return boundedText(raw, MAX_NAME_CHARS);
  return boundedText(raw, MAX_INSTRUCTION_CHARS);
}

function EditControl({ kind, label, value, invalid, errorId, onChange }: {
  kind: ReviewFieldKind;
  label: string;
  value: string;
  invalid: boolean;
  errorId: string;
  onChange: (value: string) => void;
}) {
  const props = {
    value,
    "aria-invalid": invalid,
    "aria-describedby": invalid ? errorId : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };
  if (kind === "instruction") {
    return <textarea autoFocus aria-label={`New ${label}`} rows={4} {...props} />;
  }
  if (["mode", "food-state", "oven-operation", "boolean"].includes(kind)) {
    const options = kind === "mode"
      ? [["active", "Active"], ["passive", "Passive"]]
      : kind === "food-state"
        ? [["", "Not stated"], ["raw", "Raw"], ["cooked", "Cooked"], ["other", "Other"]]
        : kind === "oven-operation"
          ? [["", "None"], ["preheat", "Preheat"], ["cook", "Cook"], ["temperature-change", "Temperature change"]]
          : [["true", "Yes"], ["false", "No"]];
    return (
      <select autoFocus aria-label={`New ${label}`} {...props}>
        {options.map(([optionValue, text]) => <option key={optionValue} value={optionValue}>{text}</option>)}
      </select>
    );
  }
  const numeric = kind === "positive-number"
    || kind === "nullable-positive-number"
    || kind === "nullable-temperature";
  const temperature = kind === "nullable-temperature";
  return <input autoFocus aria-label={`New ${label}`} type={numeric ? "number" : "text"} min={temperature ? "-100" : numeric ? "0.01" : undefined} max={temperature ? "1000" : undefined} step={numeric ? "any" : undefined} {...props} />;
}

export function ReviewField({ label, contextLabel, kind, sourceText, review, displayValue, onConfirm, onEdit }: ReviewFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => editorText(review.value));
  const [error, setError] = useState<string | null>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const editorWasOpen = useRef(false);
  const focusAfterConfirm = useRef(false);
  const contextSuffix = contextLabel ? ` in ${contextLabel}` : "";
  const errorId = `${useId()}-edit-error`;

  useEffect(() => {
    if (editing) {
      editorWasOpen.current = true;
    } else if (editorWasOpen.current) {
      editorWasOpen.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (focusAfterConfirm.current && review.status === "confirmed") {
      focusAfterConfirm.current = false;
      editButtonRef.current?.focus();
    }
  }, [review.status]);

  const save = () => {
    const parsed = parseEdit(kind, draft);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    onEdit(parsed.value, "User-confirmed correction");
    setError(null);
    setEditing(false);
  };

  return (
    <div className="review-field">
      <div className="review-field__heading">
        <strong className="review-field__label">{label}</strong>
        <span>{review.status === "confirmed" ? "Confirmed" : "Needs review"}</span>
      </div>
      <p className="review-field__value">{displayValue ?? displayText(review.value)}</p>
      <ReviewEvidence label={label} contextLabel={contextLabel} sourceText={sourceText} review={review} />
      {editing ? (
        <div className="review-field__editor">
          <EditControl
            kind={kind}
            label={`${label}${contextSuffix}`}
            value={draft}
            invalid={error !== null}
            errorId={errorId}
            onChange={setDraft}
          />
          {error && <p id={errorId} role="alert">{error}</p>}
          <div className="review-field__actions">
            <Button aria-label={`Save ${label}${contextSuffix}`} variant="primary" onClick={save}>Save {label}</Button>
            <Button aria-label={`Cancel editing ${label}${contextSuffix}`} variant="quiet" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="review-field__actions">
          {review.status === "needs-review" && (
            <Button
              aria-label={`${review.value === null ? `Confirm not stated for ${label}` : `Confirm ${label}`}${contextSuffix}`}
              variant="primary"
              onClick={() => {
                focusAfterConfirm.current = true;
                onConfirm();
              }}
            >
              {review.value === null ? `Confirm not stated for ${label}` : `Confirm ${label}`}
            </Button>
          )}
          <Button aria-label={`Edit ${label}${contextSuffix}`} ref={editButtonRef} variant="quiet" onClick={() => { setDraft(editorText(review.value)); setEditing(true); }}>
            Edit {label}
          </Button>
        </div>
      )}
    </div>
  );
}
