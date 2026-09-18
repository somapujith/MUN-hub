import { buildSocialPreviewDocument, fetchMunForSocialPreview } from "../src/lib/social-preview";

/**
 * Vercel Function backing web/vercel.json's bot-only rewrite of
 * /mun/:slug -> /api/social-preview?slug=:slug (see that file's `has` header
 * condition). Only ever reached by a request whose User-Agent matched a
 * known link-unfurl/search bot; a real browser always gets the real SPA
 * build straight from static hosting and never hits this function.
 *
 * This is www.munhub.in's equivalent of
 * web/src/server/social-preview-worker.ts — that one runs on the Cloudflare
 * Worker serving app./publish./admin./*.munhub.in, this one runs on Vercel,
 * which is what actually serves the canonical www.munhub.in host (see
 * CLAUDE.md's "Deploy config" section). Both share
 * web/src/lib/social-preview.ts so the tags stay identical either way.
 *
 * Default (Node.js) runtime — no `export const config` needed for a plain
 * project (see https://vercel.com/docs/functions/configuring-functions/runtime).
 */

// Hardcoded, not read from an env var: this function only ever runs on the
// production Vercel deployment (www.munhub.in/munhub.in) — there is no
// separate staging Vercel environment to branch on (staging lives entirely
// on Cloudflare; see web/wrangler.jsonc's env.staging).
const API_BASE_URL = "https://api.munhub.in";

export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) {
    return new Response("Not found", { status: 404 });
  }

  const mun = await fetchMunForSocialPreview(slug, API_BASE_URL);
  if (!mun) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(buildSocialPreviewDocument(mun), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
