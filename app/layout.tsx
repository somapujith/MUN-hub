import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// Haas Grotesk / Haas Groot Disp are licensed and unavailable. Per
// DESIGN-airtable.md "Note on Font Substitutes", Inter (variable) is the closest
// open substitute for both text and display roles. Both variables point at the
// same variable family; the display role differs by weight/tracking, not family,
// and the pricing sub-system's 475/575 mid-weights are reachable because the
// variable axis is continuous.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
});

const interDisplay = Inter({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MUN Hub — Find and register for Model UN conferences",
    template: "%s | MUN Hub",
  },
  description:
    "Discover, compare, and register for Model United Nations conferences. Curated committees, transparent pricing, verified organizers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${interDisplay.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
