import "@fontsource/fraunces/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/600.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./review.css";

export const metadata: Metadata = {
  title: "DinnerSync — One finish line for dinner",
  description: "Turn three recipes into one resource-aware service plan.",
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
