import "@fontsource/fraunces/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "DinnerSync",
  description: "Plan together. Cook on time.",
};

type RootLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
