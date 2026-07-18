import type { FormEvent } from "react";

import { Button } from "./ui/button";
import { Panel } from "./ui/panel";
import { StatusChip } from "./ui/status-chip";

export type SetupFormValues = {
  recipeTexts: [string, string, string];
  diners: number;
  availableTime: string;
  serveTime: string;
  targetKcalPerPerson: string;
  burners: 1 | 2;
  notes: string;
};

export type SetupScreenProps = {
  mode: "hosted" | "local";
  values: SetupFormValues;
  consentToSend: boolean;
  onModeChange(mode: "hosted" | "local"): void;
  onValuesChange(values: SetupFormValues): void;
  onConsentChange(consent: boolean): void;
  onLoadDemo(): void;
  onSubmit(recipeTexts: string[]): void;
};

const RECIPE_NAMES = ["Main dish", "Vegetable", "Starch"] as const;

function ServicePreview({ serveTime }: { serveTime: string }) {
  return (
    <Panel className="service-preview" tone="ink" aria-labelledby="preview-title">
      <div className="service-preview__topline">
        <p className="eyebrow">Service preview</p>
        <StatusChip tone="time">5 minute landing window</StatusChip>
      </div>
      <h2 id="preview-title">One finish line.<br />Three dishes.</h2>
      <p className="service-preview__intro">
        DinnerSync turns separate recipes into one resource-aware run of show.
      </p>
      <div className="service-map">
        <ul className="service-tracks" aria-label="Service tracks">
          {[
            ["Main", "Cook"],
            ["Vegetables", "Oven"],
            ["Starch", "Burner"],
          ].map(([dish, resource]) => (
            <li
              className="service-track"
              key={dish}
              aria-label={`${dish} uses ${resource}`}
            >
              <span>{dish}</span>
              <i aria-hidden="true" />
              <small>{resource}</small>
            </li>
          ))}
        </ul>
        <div className="service-landing">
          <span>Dinner lands</span>
          <time dateTime={serveTime || undefined}>{serveTime || "—:—"}</time>
        </div>
      </div>
      <p className="service-preview__note">
        Active work, oven time, and burners share one readable service clock.
      </p>
    </Panel>
  );
}

export function SetupScreen({
  mode,
  values,
  consentToSend,
  onModeChange,
  onValuesChange,
  onConsentChange,
  onLoadDemo,
  onSubmit,
}: SetupScreenProps) {
  const update = <Key extends keyof SetupFormValues>(
    key: Key,
    value: SetupFormValues[Key],
  ) => onValuesChange({ ...values, [key]: value });

  const updateRecipe = (index: number, recipe: string) => {
    const recipeTexts = [...values.recipeTexts] as SetupFormValues["recipeTexts"];
    recipeTexts[index] = recipe;
    update("recipeTexts", recipeTexts);
  };

  const submittedRecipes = values.recipeTexts
    .filter((recipe) => recipe.trim().length > 0);
  const dinersValid = Number.isInteger(values.diners)
    && values.diners >= 1
    && values.diners <= 12;
  const availableTimeValid = values.availableTime !== "";
  const serveTimePresent = values.serveTime !== "";
  const timeOrderValid = !availableTimeValid
    || !serveTimePresent
    || values.serveTime > values.availableTime;
  const serveTimeValid = serveTimePresent && timeOrderValid;
  const timesValid = availableTimeValid && serveTimePresent && timeOrderValid;
  const targetKcal = Number(values.targetKcalPerPerson);
  const targetKcalValid = values.targetKcalPerPerson.trim() === ""
    || (Number.isFinite(targetKcal) && targetKcal > 0);
  const formComplete = submittedRecipes.length > 0
    && dinersValid
    && timesValid
    && targetKcalValid;
  const canSubmit = mode === "local" && consentToSend && formComplete;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canSubmit) onSubmit(submittedRecipes);
  };

  return (
    <div className="setup-layout">
      <form className="setup-form" onSubmit={submit}>
        <header className="setup-heading">
          <p className="eyebrow">01 · Mise en place</p>
          <h2>Set the table for a synced dinner.</h2>
          <p>Bring up to three recipes. We will line up the work so every dish lands together.</p>
        </header>

        <fieldset className="mode-picker">
          <legend>Choose a planning mode</legend>
          <label className="mode-option">
            <input
              type="radio"
              name="mode"
              value="hosted"
              checked={mode === "hosted"}
              onChange={() => onModeChange("hosted")}
            />
            <span><strong>Hosted Demo</strong><small>Built-in, pre-reviewed recipes. No data leaves this browser.</small></span>
          </label>
          <label className="mode-option">
            <input
              type="radio"
              name="mode"
              value="local"
              checked={mode === "local"}
              onChange={() => onModeChange("local")}
            />
            <span><strong>Local AI</strong><small>Recipe text is sent to OpenAI through your logged-in Codex.</small></span>
          </label>
        </fieldset>

        {mode === "hosted" && (
          <div className="demo-callout">
            <div><strong>Judge-ready in one click</strong><span>No login, model call, or personal recipe required.</span></div>
            <Button variant="secondary" onClick={onLoadDemo}>Try the 650 kcal demo</Button>
          </div>
        )}

        {mode === "local" && (
          <div className="form-action form-action--local">
            <Button type="submit" disabled={!canSubmit}>Build my service plan</Button>
            <small>{!consentToSend ? "Consent is required before parsing can begin." : !formComplete ? "Add at least one recipe and check the service settings." : "Ready for structured recipe review."}</small>
          </div>
        )}

        <fieldset className="recipe-fieldset" disabled={mode === "hosted"}>
          <legend>Up to three recipes</legend>
          <p id="recipe-help">Paste the complete source text, including ingredients and steps.</p>
          {RECIPE_NAMES.map((name, index) => (
            <label key={name} className="recipe-input">
              <span>Recipe {index + 1} <small>{name}</small></span>
              <textarea
                value={values.recipeTexts[index]}
                onChange={(event) => updateRecipe(index, event.target.value)}
                aria-describedby="recipe-help"
                placeholder={`${name} recipe text…`}
                rows={4}
              />
            </label>
          ))}
        </fieldset>

        <fieldset className="settings-fieldset">
          <legend>Service settings</legend>
          <div className="field-grid">
            <label>
              <span>Diners</span>
              <input type="number" min="1" max="12" value={values.diners} onChange={(event) => update("diners", Number(event.target.value))} required aria-invalid={!dinersValid} aria-describedby="diners-help" />
              <small id="diners-help" className={!dinersValid ? "field-error" : undefined}>{dinersValid ? "Plan for 1 to 12 people." : "Choose a diner count between 1 and 12."}</small>
            </label>
            <label>
              <span>Available from</span>
              <input type="time" value={values.availableTime} onChange={(event) => update("availableTime", event.target.value)} required aria-invalid={!availableTimeValid} aria-describedby="available-time-help" />
              <small id="available-time-help" className={!availableTimeValid ? "field-error" : undefined}>{availableTimeValid ? "Earliest time preparation can begin." : "Choose when cooking can begin."}</small>
            </label>
            <label>
              <span>Dinner lands</span>
              <input type="time" value={values.serveTime} onChange={(event) => update("serveTime", event.target.value)} required aria-label="Dinner lands" aria-invalid={!serveTimeValid} aria-describedby="serve-time-help" />
              <small id="serve-time-help" className={!serveTimeValid ? "field-error" : undefined}>{!serveTimePresent ? "Choose when dinner should land." : !timeOrderValid ? "Dinner must land after available time on the same day." : "Same-day service, after preparation begins."}</small>
            </label>
            <label>
              <span>Target kcal / person <small>Optional</small></span>
              <input type="number" min="1" value={values.targetKcalPerPerson} onChange={(event) => update("targetKcalPerPerson", event.target.value)} aria-invalid={!targetKcalValid} aria-describedby="kcal-help" />
              <small id="kcal-help" className={!targetKcalValid ? "field-error" : undefined}>{targetKcalValid ? "Optional estimate you provide; not medical or weight-loss advice." : "Enter a positive number or leave it blank."}</small>
            </label>
          </div>
          <div className="resource-row" aria-label="Kitchen resources">
            <StatusChip>1 cook</StatusChip><StatusChip>1 oven</StatusChip>
            <label><span>Burners</span><select value={values.burners} onChange={(event) => update("burners", Number(event.target.value) as 1 | 2)}><option value="1">1</option><option value="2">2</option></select></label>
            <StatusChip tone="time">Fixed 5 minute landing window</StatusChip>
          </div>
          <label className="notes-field">
            <span>Diet &amp; allergy notes <small>Optional</small></span>
            <textarea value={values.notes} onChange={(event) => update("notes", event.target.value)} rows={2} aria-describedby="notes-help" />
            <small id="notes-help">Notes only. DinnerSync does not detect or guarantee allergen safety.</small>
          </label>
        </fieldset>

        {mode === "local" && (
          <label className="consent-field">
            <input type="checkbox" checked={consentToSend} onChange={(event) => onConsentChange(event.target.checked)} />
            <span><strong>I agree to send these recipes to OpenAI.</strong><small>Codex runs locally, but the recipe text is processed by OpenAI.</small></span>
          </label>
        )}

      </form>
      <ServicePreview serveTime={values.serveTime} />
    </div>
  );
}
