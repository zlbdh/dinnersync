"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { NutritionRecord } from "@/modules/nutrition";
import type {
  RecipeReviewAction,
  RecipeReviewState,
} from "@/modules/recipe-import";

import { RecipeReview } from "./recipe-review";
import { ReviewSummary, type ReviewPlanError } from "./review-summary";
import { Button } from "./ui/button";

export type ReviewScreenProps = {
  reviewStates: readonly RecipeReviewState[];
  nutritionCatalog: readonly NutritionRecord[];
  mode: "hosted" | "local" | "unknown";
  note: string;
  planReady: boolean;
  planErrors: readonly ReviewPlanError[];
  onReviewChange: (recipeId: string, action: RecipeReviewAction) => void;
  onBuildPlan: () => void;
  onBack: () => void;
};

export function ReviewScreen(props: ReviewScreenProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [invalidTargetIds, setInvalidTargetIds] = useState<Set<string>>(() => new Set());
  const stepLabels = useMemo(() => new Map(props.reviewStates.flatMap((state, recipeIndex) =>
    state.draft.steps.map((step, index) => [
      step.id,
      `Recipe ${recipeIndex + 1} (${state.draft.name.value}) / Step ${index + 1}`,
    ]))), [props.reviewStates]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const updateTargetValidity = (recipeId: string, valid: boolean) => {
    setInvalidTargetIds((current) => {
      if (current.has(recipeId) === !valid) return current;
      const next = new Set(current);
      if (valid) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  };
  const targetErrors: ReviewPlanError[] = [...invalidTargetIds].map((recipeId) => ({
    path: `${recipeId}.targetServings`,
    message: "Enter a positive whole number of target servings.",
  }));
  const planReady = props.planReady && invalidTargetIds.size === 0;

  return (
    <section className="review-screen" aria-labelledby="review-title">
      <header className="review-intro">
        <p className="eyebrow">02 · Check the extraction</p>
        <h2 ref={titleRef} id="review-title" tabIndex={-1}>
          Review every field before the clock starts.
        </h2>
        {props.mode === "hosted" ? (
          <p><strong>Built-in reviewed fixture</strong><span>No model request was made</span></p>
        ) : props.mode === "local" ? (
          <p><strong>AI proposed the structure. You decide what becomes part of the plan.</strong></p>
        ) : (
          <p><strong>Restored reviewed plan</strong><span>Origin metadata was unavailable, so no model claim is shown.</span></p>
        )}
      </header>
      <nav className="review-shortcuts" aria-label="Review shortcuts">
        <a className="button button--secondary" href="#review-summary-title">
          Decision ledger
        </a>
        <Button variant="quiet" onClick={props.onBack}>Back to setup</Button>
      </nav>
      <div className="review-layout">
        <div className="review-recipes">
          {props.reviewStates.map((state, recipeIndex) => (
            <RecipeReview
              key={state.draft.id}
              state={state}
              recipeIndex={recipeIndex}
              catalog={props.nutritionCatalog}
              stepLabels={stepLabels}
              onChange={props.onReviewChange}
              onTargetValidityChange={updateTargetValidity}
            />
          ))}
        </div>
        <ReviewSummary
          reviewStates={props.reviewStates}
          note={props.note}
          planReady={planReady}
          planErrors={[...props.planErrors, ...targetErrors]}
          onBuildPlan={props.onBuildPlan}
        />
      </div>
    </section>
  );
}
