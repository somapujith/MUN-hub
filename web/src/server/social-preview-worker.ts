import { getHostZone } from "../lib/host-routing";
import { buildSocialPreviewHead, fetchMunForSocialPreview, isCrawlerUserAgent } from "../lib/social-preview";
import type { MunDetail } from "../types";

/**
 * munhub-web's Cloudflare Worker entry point (wrangler.jsonc: `main` +
 * `assets.run_worker_first`). Runs in front of the static SPA build for
 * every request on app./publish./admin.munhub.in and the *.munhub.in
 * wildcard (per-MUN slug pages) — NOT www.munhub.in/munhub.in, which is
 * still served by Vercel (web/vercel.json + web/api/social-preview.ts is
 * that host's equivalent fix, using the same web/src/lib/social-preview.ts).
 *
 * See web/src/lib/social-preview.ts's header comment for why this exists at
 * all. Anything that isn't a bot hitting a MUN page is an untouched
 * env.ASSETS.fetch(request) passthrough — zero added latency on the normal
 * path.
 */

interface Env {
  ASSETS: Fetcher;
  /** Defaults to production; overridden per-env in wrangler.jsonc for staging. */
  API_BASE_URL?: string;
}

const DEFAULT_API_BASE_URL = "https://api.munhub.in";

/** The MUN slug this request's path or wildcard host is asking for, if any. */
function resolveMunSlug(url: URL): string | null {
  if (url.pathname === "/") {
    const zone = getHostZone(url.hostname);
    return zone.zone === "mun" ? zone.munSlug : null;
  }
  const match = /^\/mun\/([^/]+)\/?$/.exec(url.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function rewriteForMun(assetResponse: Response, mun: MunDetail): Response {
  const { title, headHtml } = buildSocialPreviewHead(mun);
  return new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on("[data-default-seo]", {
      element(element) {
        element.remove();
      },
    })
    .on("head", {
      element(element) {
        element.append(headHtml, { html: true });
      },
    })
    .transform(assetResponse);
}

async function proxySitemap(apiBaseUrl: string): Promise<Response> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/sitemap.xml`);
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/xml; charset=utf-8" },
    });
  } catch {
    return new Response("Sitemap temporarily unavailable", { status: 502 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const apiBaseUrl = env.API_BASE_URL ?? DEFAULT_API_BASE_URL;

    if (request.method === "GET" && url.pathname === "/sitemap.xml") {
      return proxySitemap(apiBaseUrl);
    }

    if (request.method !== "GET" || !isCrawlerUserAgent(request.headers.get("user-agent"))) {
      return env.ASSETS.fetch(request);
    }

    const slug = resolveMunSlug(url);
    if (!slug) {
      return env.ASSETS.fetch(request);
    }

    const [mun, assetResponse] = await Promise.all([
      fetchMunForSocialPreview(slug, apiBaseUrl),
      env.ASSETS.fetch(request),
    ]);
    if (!mun || !assetResponse.ok) {
      return assetResponse;
    }

    return rewriteForMun(assetResponse, mun);
  },
};
