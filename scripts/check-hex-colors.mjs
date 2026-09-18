#!/usr/bin/env node
/**
 * Guards against raw hex color literals silently bypassing the design-token
 * system in `/web` (`text-ink`, `bg-surface-soft`, etc.). This codebase has
 * shipped two dark-mode bugs from exactly this: a CTA band and a delegate-pass
 * header that used a hardcoded hex instead of a theme-reactive token and went
 * unreadable/invisible in dark mode. This script is the cheap check that
 * catches the *next* one before it ships: it fails if it finds a raw hex color
 * literal anywhere in `web/src/**\/*.{ts,tsx,css}` that isn't in the ALLOWLIST
 * below.
 *
 * Every entry in the ALLOWLIST was checked by hand (grepped, read in context,
 * and matched against a real documented reason already in the code — e.g. a
 * comment, or CLAUDE.md) — not added speculatively. If you add a new
 * legitimate fixed-color usage, add it here with a one-line reason. If this
 * script flags something you didn't expect, don't allowlist it reflexively:
 * check whether it's actually a dark-mode bug first, and fix it with the
 * closest matching token instead (see the delegate-pass-header fix for the
 * pattern: replace the raw hex with e.g. `bg-surface-soft`/`text-ink`, adding
 * a `dark:` override only if the light-mode token doesn't already flip).
 *
 * Run: node scripts/check-hex-colors.mjs   (wired to `npm run lint:colors`)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIR = join(ROOT, "web", "src");
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

// Matches a hex color literal (#fff, #ffff, #ffffff, #ffffffff) but not a
// `file.ts#anchorName`-style reference or part of a longer identifier: the
// lookbehind excludes a preceding word char / `.` / `/` / `#` / `-`, and the
// lookahead excludes a following word char / `-` (e.g. `pricing.ts#effective
// PassPrice` doesn't match: `#e` is preceded by the word char `s`).
const HEX_COLOR_RE =
  /(?<![\w./#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;

/**
 * Whole-file exemptions, grouped by shared reason. Deliberately file-level,
 * not line-level: in every case below, ALL of that file's hex literals are
 * covered by the one reason given (verified by reading each file, not
 * assumed) — see the design-critic/adversarial-coach history in CLAUDE.md for
 * why "cream surface -> fixed ink" and "organizer bright shell -> fixed
 * light theme" are established, intentional patterns here, not oversights.
 */
const ALLOWLIST_GROUPS = [
  {
    reason:
      "Design-token *definitions* themselves (:root / .dark custom properties) — this file IS the source of truth every other file should reference via var()/token classes, not duplicate.",
    files: ["web/src/index.css"],
  },
  {
    reason:
      "Defines the SignatureCard `cream`/`strong` variants, which intentionally use fixed ink (#181d26) regardless of theme because their background (cream / surface-strong) doesn't invert with theme either — documented in this file's own header/inline comments.",
    files: ["web/src/components/ui/signature-card.tsx"],
  },
  {
    reason:
      "Text/icon rendered on a `cream` / `bg-signature-cream` surface (a SignatureCard variant, or the badge `cream` variant, or the legal page's 'short version' box), which is a fixed light backing regardless of theme — must use the matching fixed ink/body color, not a theme-reactive token that would go light-on-light in dark mode. Same doctrine as signature-card.tsx above.",
    files: [
      "web/src/pages/home-page.tsx",
      "web/src/pages/mun-detail-page.tsx",
      "web/src/pages/about/about-page.tsx",
      "web/src/pages/about/curation-standards-page.tsx",
      "web/src/components/mun/mun-card-grid.tsx",
      "web/src/components/mun/mun-official-contact.tsx",
      "web/src/components/legal/legal-document.tsx",
      "web/src/components/ui/badge.tsx",
    ],
  },
  {
    reason:
      "Backdrop scrim rendered behind a modal/sheet — deliberately the same translucent dark overlay in both themes (like most overlay/scrim UI), not a themed content surface.",
    files: ["web/src/components/ui/dialog.tsx", "web/src/components/ui/sheet.tsx"],
  },
  {
    reason:
      "`on-dark` button variant: a white pill with fixed ink text, for use on colored/dark SignatureCard surfaces (coral/forest/dark), so it must NOT invert with theme. Also has one comment documenting a past tailwind-merge bug by its old (already-fixed) broken color value, not live styling.",
    files: ["web/src/components/ui/button.tsx"],
  },
  {
    reason:
      "Comment only, documenting a past (already-fixed) contrast bug by its old broken color values for context — not live styling.",
    files: ["web/src/components/mun/mun-hero.tsx"],
  },
  {
    reason:
      "`print:` variant border color on the delegate-pass card, with an adjacent comment explaining why: the card header's `surface-dark` token equals the app's own dark-mode canvas color, so a themed border would blend invisibly — same reasoning as signature-card.tsx's `dark` variant, applied to print output (which is always rendered light regardless of the app's theme).",
    files: ["web/src/pages/dashboard/registration-pass-page.tsx"],
  },
  {
    reason:
      "Camera-preview <video> placeholder background — intentionally a fixed dark box (like any camera viewfinder/video player placeholder), not a themed content surface. Bounded by a theme-reactive `border-border` so it stays visually distinct from the page in both themes.",
    files: ["web/src/components/organizer/check-in-panel.tsx"],
  },
  {
    reason:
      "Decorative brand photo/gradient panel (+ its white overlay text) on the auth split-layout screen, hidden below `lg`. A fixed marketing visual that's meant to look the same regardless of site theme, same doctrine as the organizer bright shell below.",
    files: ["web/src/components/auth/auth-split-layout.tsx"],
  },
  {
    reason:
      "The organizer 'bright shell' system (publish.munhub.in's welcome page + onboarding wizard + apply/resubmit pages): deliberately always the bright/light theme regardless of the site-wide theme, per explicit user direction — see organizer-bright-shell.tsx's own header comment and CLAUDE.md's 'Organizer onboarding wizard' / 'Organizer email-code sign-in' sections.",
    files: [
      "web/src/pages/organizer/organizer-welcome-page.tsx",
      "web/src/pages/organizer/organizer-onboarding-page.tsx",
      "web/src/pages/organizer/organizer-resubmit-page.tsx",
      "web/src/pages/organizer/organizer-apply-page.tsx",
      "web/src/pages/organizer/apply-submitted-page.tsx",
      "web/src/components/organizer/organizer-bright-shell.tsx",
      "web/src/components/organizer/bright-form.tsx",
      "web/src/components/organizer/organizer-bright-skeleton.tsx",
    ],
  },
];

const ALLOWLIST = new Map();
for (const group of ALLOWLIST_GROUPS) {
  for (const file of group.files) {
    ALLOWLIST.set(file, group.reason);
  }
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      files.push(full);
    }
  }
  return files;
}

function toRepoRelativePosix(absPath) {
  return relative(ROOT, absPath).split("\\").join("/");
}

const violations = [];

for (const absPath of walk(SCAN_DIR)) {
  const relPath = toRepoRelativePosix(absPath);
  if (ALLOWLIST.has(relPath)) continue;

  const content = readFileSync(absPath, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    const matches = line.match(HEX_COLOR_RE);
    if (matches && matches.length > 0) {
      violations.push({ file: relPath, line: index + 1, matches, text: line.trim() });
    }
  });
}

if (violations.length > 0) {
  console.error(
    `\nlint:colors — found ${violations.length} raw hex color literal(s) in web/src outside the documented allowlist:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.matches.join(", ")}]`);
    console.error(`    ${v.text}`);
  }
  console.error(
    `\nA raw hex color bypasses the design-token system and can silently break dark mode (this repo has shipped that bug twice already).\n` +
      `  - If this is a real bug: replace it with the closest matching token/class (e.g. bg-surface-soft, text-ink), same as the delegate-pass-header fix.\n` +
      `  - If it's a genuine intentional exception (a surface that must NOT invert with theme): add it to ALLOWLIST_GROUPS in scripts/check-hex-colors.mjs with a one-line reason.\n`,
  );
  process.exitCode = 1;
} else {
  console.log(`lint:colors — no undocumented hex color literals found in ${toRepoRelativePosix(SCAN_DIR)}.`);
}
