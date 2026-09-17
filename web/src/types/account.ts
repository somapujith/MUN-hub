/** Mirrors lib/actions/account.ts's AccountSettings. */
export interface AccountSettings {
  name: string;
  email: string;
  phone: string | null;
  institution: string | null;
  emailNotificationsEnabled: boolean;
  /** Whether the email address has been confirmed through a verification link. */
  emailVerified: boolean;
  /** Registration is blocked until the email is verified (server REQUIRE_EMAIL_VERIFICATION). */
  emailVerificationRequired: boolean;
}

/** Body of POST /account/delete — mirrors lib/actions/account-deletion.ts's DeleteAccountInput. */
export interface DeleteAccountInput {
  /** Must be exactly "DELETE". */
  confirmation: string;
  password: string;
}
