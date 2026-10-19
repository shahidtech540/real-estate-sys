import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// Strings are not rendered here: every user-visible label comes from the i18n
// catalogs (AGENTS.md §5.11, ARCHITECTURE.md §9.4). Phase 1 wires the provider.
export const metadata: Metadata = {
  title: "SPM",
  description: "Society Plot Manager",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
