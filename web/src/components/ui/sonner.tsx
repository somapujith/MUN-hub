import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          // Toasts sit on the content-card tier: {rounded.md} (10px), canvas
          // surface, hairline border. Status glyph colors come from the
          // semantic -text tokens so they stay readable on the light surface.
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--success-text)",
          "--success-border": "var(--border)",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--destructive-text)",
          "--error-border": "var(--border)",
          "--warning-bg": "var(--popover)",
          "--warning-text": "var(--warning-text)",
          "--warning-border": "var(--border)",
          "--info-bg": "var(--popover)",
          "--info-text": "var(--info-text)",
          "--info-border": "var(--border)",
          "--border-radius": "var(--radius-step-md)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
