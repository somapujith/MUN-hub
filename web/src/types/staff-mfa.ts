/** Staff TOTP two-factor auth — mirrors lib/actions/staff-mfa.ts. */

export interface MfaEnrollmentStatus {
  confirmed: boolean;
}

export interface MfaSetupResult {
  /** Base32 secret, for a "can't scan the code" manual-entry fallback. */
  secret: string;
  /** otpauth:// URI — turn into a QR code, or open directly on mobile. */
  otpauthUri: string;
}

export interface MfaConfirmResult {
  /** Shown to the user exactly once — only scrypt hashes are stored server-side. */
  recoveryCodes: string[];
}
