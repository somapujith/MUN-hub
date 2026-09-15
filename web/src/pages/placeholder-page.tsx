import { Helmet } from "react-helmet-async";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="content-container py-section">
      <Helmet title={title} />
      <h1 className="font-display text-display-md text-ink">{title}</h1>
      <p className="text-body-md text-muted-foreground">Placeholder — wired in a later phase.</p>
    </div>
  );
}
