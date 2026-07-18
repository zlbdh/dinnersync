const STEPS = ["Setup", "Review", "Plan", "Cook", "Summary"] as const;

export type ProgressStep = (typeof STEPS)[number];

export function ProgressRail({ current }: { current: ProgressStep }) {
  const currentIndex = STEPS.indexOf(current);

  return (
    <nav className="progress-rail" aria-label="Dinner planning progress">
      <ol>
        {STEPS.map((step, index) => (
          <li
            key={step}
            className={index < currentIndex ? "is-complete" : undefined}
            aria-current={step === current ? "step" : undefined}
          >
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            {step}
          </li>
        ))}
      </ol>
    </nav>
  );
}
