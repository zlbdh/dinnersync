"use client";

import { useEffect, useRef } from "react";

import { Button } from "./ui/button";
import { Panel } from "./ui/panel";
import { StatusChip } from "./ui/status-chip";

export function PlanHandoff({ onBack }: { onBack: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <Panel className="handoff" aria-labelledby="handoff-title">
      <p className="eyebrow">03 · Service plan</p>
      <h2 ref={titleRef} id="handoff-title" tabIndex={-1}>Service timeline ready.</h2>
      <p>
        Confirmed recipes, nutrition decisions, dependencies, and kitchen resources are now
        part of one validated plan.
      </p>
      <div className="handoff__actions">
        <Button variant="secondary" onClick={onBack}>Back to setup</Button>
        <StatusChip tone="complete">Plan built from reviewed data</StatusChip>
      </div>
    </Panel>
  );
}
