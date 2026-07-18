import type { ReactNode } from "react";

export function StatusChip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "time" | "complete";
}) {
  return <span className={`status-chip status-chip--${tone}`}>{children}</span>;
}
