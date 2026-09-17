import path from 'node:path'

/** Overridable so several suite runs (e.g. on different ports) don't overwrite each other's sessions. */
export const AUTH_DIR = path.resolve(__dirname, process.env.E2E_AUTH_DIR ?? '.auth')

/**
 * Where the local API writes every email it "sends" (EMAIL_OUTBOX_FILE, read
 * by lib/notifications/console-adapter.ts). One JSON line per message. Keyed
 * by API port so side-by-side runs don't share a file. Gitignored.
 */
export const EMAIL_OUTBOX_FILE = path.resolve(
  __dirname,
  process.env.E2E_EMAIL_OUTBOX ?? `.outbox/email-${process.env.E2E_API_PORT ?? 3101}.jsonl`,
)

/** Saved per-role sessions written by setup/auth.setup.ts (gitignored). */
export const STORAGE_STATE = {
  student: path.join(AUTH_DIR, 'student.json'),
  organizer: path.join(AUTH_DIR, 'organizer.json'),
  admin: path.join(AUTH_DIR, 'admin.json'),
} as const
