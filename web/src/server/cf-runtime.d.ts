// Minimal ambient types for the two Cloudflare Workers-only runtime globals
// social-preview-worker.ts needs (HTMLRewriter, Fetcher). Request/Response/
// URL/fetch/AbortController are already covered by tsconfig.app.json's DOM
// lib. Deliberately not pulling in @cloudflare/workers-types for this — it
// declares its own Request/Response that collide with DOM lib's when both
// are in the same program, which is exactly why server/tsconfig.json avoids
// it too (hand-rolled minimal Env types instead of the full package).

interface RewriterContentOptions {
  html?: boolean;
}

interface RewriterElement {
  setInnerContent(content: string, options?: RewriterContentOptions): void;
  append(content: string, options?: RewriterContentOptions): void;
  remove(): void;
}

interface ElementHandlers {
  element?(element: RewriterElement): void;
}

declare class HTMLRewriter {
  on(selector: string, handlers: ElementHandlers): HTMLRewriter;
  transform(response: Response): Response;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
