import type { InferSelectModel } from 'drizzle-orm'
import type { users } from '@/lib/db/schema'
import type { Role } from '@/lib/db/schema-enums'

export type User = InferSelectModel<typeof users>

/** Safe-to-expose subset of a user row — never include email/phone here. */
export interface PublicUser {
  id: string
  name: string
  username: string | null
  institution: string | null
  profileImage: string | null
  role: Role
}
