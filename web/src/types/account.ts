/** Mirrors lib/actions/account.ts's AccountSettings. */
export interface AccountSettings {
  name: string;
  email: string;
  phone: string | null;
  institution: string | null;
  emailNotificationsEnabled: boolean;
}

/** Body of POST /account/delete — mirrors lib/actions/account-deletion.ts's DeleteAccountInput. */
export interface DeleteAccountInput {
  /** Must be exactly "DELETE". */
  confirmation: string;
  password: string;
}
