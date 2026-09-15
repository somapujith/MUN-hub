"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { MoonIcon, SunIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * `button-icon-circular` — docs/prd/DESIGN-airtable.md § Buttons.
 *
 * 40 × 40 canvas surface with a hairline border and {colors.ink} icon. The doc
 * notes 40px sits just under WCAG's 44px recommendation but that the centered
 * icon compensates; the nav uses the `icon-sm` (36px) step so the control sits
 * inside the 64px bar with the doc's spacing intact, and the hit area is
 * extended below `sm` where touch matters most.
 *
 * Renders a disabled placeholder of identical geometry before mount so the
 * server HTML and the first client paint agree (the resolved theme isn't known
 * until hydration) — no layout shift, no hydration mismatch.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle theme"
        disabled
        className="disabled:opacity-100"
      >
        <SunIcon className="opacity-0" />
      </Button>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  )
}
