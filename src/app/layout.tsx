import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next, Fraunces } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/** Display serif: warm, slightly soft, mid-century print feel. */
const display = Fraunces({
  subsets: ["latin", "latin-ext"],
  axes: ["SOFT", "opsz"],
  variable: "--font-display",
  display: "swap",
});
/** Body sans designed for low-vision readers (Braille Institute). */
const body = Atkinson_Hyperlegible_Next({ subsets: ["latin", "latin-ext"], variable: "--font-body", display: "swap" });
/** Mono for Qloo request parameters in the trace. */
const code = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });

export const metadata: Metadata = {
  title: "Rekindle",
  description: "Plan a warm, era-true reminiscence activity for someone you care for.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf5eb" },
    { media: "(prefers-color-scheme: dark)", color: "#1d140f" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${code.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
