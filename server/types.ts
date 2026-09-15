import type { Session } from '@/lib/auth/adapter'

export type AppVariables = {
  session: Session | null
  requestId: string
}

export type AppEnv = {
  Variables: AppVariables
}
