import { Outlet } from "react-router";
import { Helmet } from "react-helmet-async";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function RootLayout() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <Helmet
        defaultTitle="MUN Hub — Find and register for Model UN conferences"
        titleTemplate="%s | MUN Hub"
      />
      <TooltipProvider>
        <div className="flex min-h-dvh flex-col">
          <Outlet />
        </div>
        <Toaster richColors closeButton position="top-center" />
      </TooltipProvider>
    </ThemeProvider>
  );
}

/** Public route group — chrome is per-page (matches Next SiteHeader pattern). */
export function PublicLayout() {
  return <Outlet />;
}
