/** Mirrors lib/actions/account.ts's AccountSettings. */
export interface AccountSettings {
  name: string;
  email: string;
  phone: string | null;
  institution: string | null;
  emailNotificationsEnabled: boolean;
}
