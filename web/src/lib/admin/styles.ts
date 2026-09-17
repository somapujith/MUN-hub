// Native form controls on the admin pages, matching the Input component's
// tokens (the admin pages use plain <select>/<textarea>, like support-page).

export const adminTextareaClassName =
  "min-h-20 w-full rounded-sm border border-input bg-background px-md py-sm text-body-md text-ink outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 aria-invalid:border-destructive";

export const adminSelectClassName =
  "h-10 rounded-sm border border-input bg-background px-md text-body-md text-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60";
