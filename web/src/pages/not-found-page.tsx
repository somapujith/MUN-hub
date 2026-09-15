import { Link } from "react-router";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="content-container flex flex-1 flex-col items-start justify-center gap-md py-section">
      <Helmet title="Not found" />
      <h1 className="font-display text-display-md text-ink">Page not found</h1>
      <p className="text-body-md text-muted-foreground">The page you requested does not exist.</p>
      <Button render={<Link to="/" />}>Back home</Button>
    </div>
  );
}
