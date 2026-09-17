// Runs under the repo-root Vitest config (`npx vitest run web/tests`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { allowConnectOrigin, apiOriginCsp, apiOriginOf } from "../vite-plugins/api-origin-csp";

const HEADERS_FILE = new URL("../public/_headers", import.meta.url);
const VERCEL_FILE = new URL("../vercel.json", import.meta.url);
const STAGING_API = "https://munhub-api-staging.somapujith.workers.dev";

function connectSrc(headers: string): string[] {
  const policy = headers.match(/^\s*Content-Security-Policy:(.*)$/m)?.[1] ?? "";
  const directive = policy.split(";").find((part) => part.trim().startsWith("connect-src")) ?? "";
  return directive.trim().split(/\s+/).slice(1);
}

describe("apiOriginOf", () => {
  it.each([
    ["https://api.munhub.in/api/v1", "https://api.munhub.in"],
    [`${STAGING_API}/api/v1`, STAGING_API],
    ["http://localhost:3001/api/v1", "http://localhost:3001"],
    ["/api/v1", null],
    ["", null],
    ["javascript:alert(1)", null],
  ])("%s → %s", (input, expected) => {
    expect(apiOriginOf(input)).toBe(expected);
  });
});

describe("allowConnectOrigin", () => {
  const headers = fs.readFileSync(HEADERS_FILE, "utf8");

  it("leaves the committed _headers unchanged for the production API", () => {
    expect(allowConnectOrigin(headers, "https://api.munhub.in")).toBe(headers);
  });

  it("adds a staging API origin to connect-src and changes nothing else", () => {
    const result = allowConnectOrigin(headers, STAGING_API);

    expect(connectSrc(result)).toEqual([...connectSrc(headers), STAGING_API]);
    expect(result.replace(` ${STAGING_API}`, "")).toBe(headers);
    // Idempotent.
    expect(allowConnectOrigin(result, STAGING_API)).toBe(result);
  });

  it("keeps CRLF line endings intact", () => {
    const crlf = "/*\r\n  Content-Security-Policy: default-src 'self'; connect-src 'self'\r\n  X-Frame-Options: DENY\r\n";
    expect(allowConnectOrigin(crlf, STAGING_API)).toBe(
      `/*\r\n  Content-Security-Policy: default-src 'self'; connect-src 'self' ${STAGING_API}\r\n  X-Frame-Options: DENY\r\n`,
    );
  });

  it("refuses a policy without connect-src rather than shipping one that blocks the API", () => {
    expect(() => allowConnectOrigin("/*\n  Content-Security-Policy: default-src 'self'\n", STAGING_API)).toThrow(/connect-src/);
  });

  it("ignores comment lines", () => {
    const text = "# Content-Security-Policy: see below\n";
    expect(allowConnectOrigin(text, STAGING_API)).toBe(text);
  });
});

describe("_headers and vercel.json", () => {
  it("carry the same Content-Security-Policy", () => {
    const vercel = JSON.parse(fs.readFileSync(VERCEL_FILE, "utf8")) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const vercelCsp = vercel.headers.flatMap((entry) => entry.headers).find((header) => header.key === "Content-Security-Policy");
    const headersCsp = fs.readFileSync(HEADERS_FILE, "utf8").match(/^\s*Content-Security-Policy:(.*)$/m)?.[1].trim();

    expect(vercelCsp?.value).toBe(headersCsp);
  });
});

describe("apiOriginCsp plugin", () => {
  const outDirs: string[] = [];

  afterEach(() => {
    for (const dir of outDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  type Hook = (...args: unknown[]) => void;

  /** Runs the plugin's hooks against a scratch outDir holding a copy of public/_headers. */
  function build(config: { define?: Record<string, unknown>; env?: Record<string, unknown>; write?: boolean }): string {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-origin-csp-"));
    outDirs.push(outDir);
    fs.copyFileSync(HEADERS_FILE, path.join(outDir, "_headers"));

    const plugin = apiOriginCsp();
    (plugin.configResolved as Hook)({
      root: outDir,
      define: config.define ?? {},
      env: config.env ?? {},
      build: { outDir: ".", write: config.write ?? true },
    });
    (plugin.writeBundle as Hook)();
    return fs.readFileSync(path.join(outDir, "_headers"), "utf8");
  }

  it("only runs for builds", () => {
    expect(apiOriginCsp().apply).toBe("build");
  });

  it("adds the VITE_API_URL origin a staging build bakes in", () => {
    const result = build({ env: { VITE_API_URL: `${STAGING_API}/api/v1` } });
    expect(connectSrc(result)).toContain(STAGING_API);
  });

  it("follows a define override over the loaded env, as Vite does", () => {
    const result = build({
      define: { "import.meta.env.VITE_API_URL": JSON.stringify("https://api.munhub.in/api/v1") },
      env: { VITE_API_URL: `${STAGING_API}/api/v1` },
    });
    expect(result).toBe(fs.readFileSync(HEADERS_FILE, "utf8"));
  });

  it("allows the clients' localhost fallback when no API URL is baked in", () => {
    expect(connectSrc(build({}))).toContain("http://localhost:3001");
  });

  it("leaves the file alone for a same-origin API or a build that writes nothing", () => {
    const original = fs.readFileSync(HEADERS_FILE, "utf8");
    expect(build({ env: { VITE_API_URL: "/api/v1" } })).toBe(original);
    expect(build({ env: { VITE_API_URL: `${STAGING_API}/api/v1` }, write: false })).toBe(original);
  });
});
