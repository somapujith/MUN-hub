import { ThemeProvider as NextThemesProvider } from "next-themes"
import type { ComponentProps } from "react"

/**
 * next-themes always renders an inline anti-flash `<script>` (it's built for
 * SSR). In this client-rendered SPA React never executes it and logs
 * "Encountered a script tag while rendering React component" in dev. Marking
 * it as a non-JavaScript data block silences that; nothing is lost, because
 * the provider applies the theme class from its own effect on the client.
 */
const INERT_SCRIPT_PROPS = { type: "application/json" } as const

export function ThemeProvider({
  children,
  scriptProps,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider scriptProps={{ ...INERT_SCRIPT_PROPS, ...scriptProps }} {...props}>
      {children}
    </NextThemesProvider>
  )
}
