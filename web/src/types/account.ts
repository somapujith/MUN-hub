/** Mirrors lib/actions/account.ts's AccountSettings. */
export interface AccountSettings {
  name: string;
  email: string;
  phone: string | null;
  emailNotificationsEnabled: boolean;
}
