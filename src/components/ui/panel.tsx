import type { HTMLAttributes, ReactNode } from "react";

export type PanelProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: "paper" | "ink";
};

export function Panel({
  children,
  className = "",
  tone = "paper",
  ...props
}: PanelProps) {
  return (
    <section
      className={`panel panel--${tone} ${className}`.trim()}
      {...props}
    >
      {children}
    </section>
  );
}
