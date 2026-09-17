import path from 'node:path'

/** Overridable so several suite runs (e.g. on different ports) don't overwrite each other's sessions. */
export const AUTH_DIR = path.resolve(__dirname, process.env.E2E_AUTH_DIR ?? '.auth')

/** Saved per-role sessions written by setup/auth.setup.ts (gitignored). */
export const STORAGE_STATE = {
  student: path.join(AUTH_DIR, 'student.json'),
  organizer: path.join(AUTH_DIR, 'organizer.json'),
  admin: path.join(AUTH_DIR, 'admin.json'),
} as const
