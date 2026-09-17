// -----------------------------------------------------------------------------
// organizer-ops-errors — user-facing error messages for organizer operations
// -----------------------------------------------------------------------------
//
// Roster, delegate communications, check-in and results publishing throw
// these exact strings; server/middleware/error.ts maps them to an HTTP status
// through ORGANIZER_OPS_ERROR_STATUS instead of one regex per message.

export const COMMUNICATION_LIMITS = {
  subjectMaxLength: 150,
  bodyMaxLength: 5000,
  /** Recipients per message. Larger audiences must be narrowed with filters. */
  maxRecipientsPerSend: 500,
  /** Messages per MUN in any rolling hour. */
  maxSendsPerHour: 5,
} as const

export const CHECK_IN_WINDOW_HOURS = 24

/** Hard ceiling on one roster export — far above any single conference, well below a runaway response. */
export const ROSTER_EXPORT_MAX_ROWS = 10_000

export const ORGANIZER_OPS_ERRORS = {
  // roster / attendance
  attendanceClosed: 'Attendance can only be recorded while the conference is active or awaiting results',
  attendanceNotConfirmed: 'Only confirmed registrations can be marked attended or no-show',
  attendanceHasAward: 'This delegate has an award recorded — remove the award before marking them a no-show',
  exportTooLarge: 'This export has more than 10,000 rows — narrow it with the filters and export in parts',
  // communications
  subjectTooLong: `Subject must be at most ${COMMUNICATION_LIMITS.subjectMaxLength} characters`,
  subjectMultiline: 'Subject must be a single line',
  bodyTooLong: `Message must be at most ${COMMUNICATION_LIMITS.bodyMaxLength} characters`,
  noRecipients: 'No delegates match this audience',
  audienceTooLarge: `This audience has more than ${COMMUNICATION_LIMITS.maxRecipientsPerSend} delegates — narrow it with the filters and send in parts`,
  hourlySendLimit: `This MUN has reached its limit of ${COMMUNICATION_LIMITS.maxSendsPerHour} delegate messages per hour — try again later`,
  // check-in / pass
  checkInCodeFormat: "Enter the 10-character check-in code from the delegate's pass",
  checkInCodeUnknown: 'No confirmed registration for this MUN matches that code',
  checkInNotOpen: 'Check-in is only available once the MUN is live and until the conference ends',
  checkInTooEarly: `Check-in opens ${CHECK_IN_WINDOW_HOURS} hours before the conference starts`,
  checkInNotConfigured: 'Check-in codes are not configured on this server',
  passUnavailable: 'Your pass is available once your registration is confirmed',
  // results
  resultsLocked: 'Results are locked while they are under review and once the conference is completed',
  awardNeedsConfirmedDelegate: 'Awards can only be given to confirmed or attended delegates',
  resultsNeedAward: 'Record at least one award before submitting results',
  resultsNotUnderReview: 'These results are not awaiting review',
  returnNoteRequired: 'A note is required when returning results to the organizer',
} as const

type OpsErrorCode = 'VALIDATION_FAILED' | 'CONFLICT_STATE' | 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE'

const E = ORGANIZER_OPS_ERRORS

export const ORGANIZER_OPS_ERROR_STATUS: Readonly<Record<string, { status: 400 | 404 | 409 | 429 | 503; code: OpsErrorCode }>> = {
  [E.attendanceClosed]: { status: 409, code: 'CONFLICT_STATE' },
  [E.attendanceNotConfirmed]: { status: 409, code: 'CONFLICT_STATE' },
  [E.attendanceHasAward]: { status: 409, code: 'CONFLICT_STATE' },
  [E.exportTooLarge]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.subjectTooLong]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.subjectMultiline]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.bodyTooLong]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.noRecipients]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.audienceTooLarge]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.hourlySendLimit]: { status: 429, code: 'RATE_LIMITED' },
  [E.checkInCodeFormat]: { status: 400, code: 'VALIDATION_FAILED' },
  [E.checkInCodeUnknown]: { status: 404, code: 'NOT_FOUND' },
  [E.checkInNotOpen]: { status: 409, code: 'CONFLICT_STATE' },
  [E.checkInTooEarly]: { status: 409, code: 'CONFLICT_STATE' },
  [E.checkInNotConfigured]: { status: 503, code: 'UNAVAILABLE' },
  [E.passUnavailable]: { status: 409, code: 'CONFLICT_STATE' },
  [E.resultsLocked]: { status: 409, code: 'CONFLICT_STATE' },
  [E.awardNeedsConfirmedDelegate]: { status: 409, code: 'CONFLICT_STATE' },
  [E.resultsNeedAward]: { status: 409, code: 'CONFLICT_STATE' },
  [E.resultsNotUnderReview]: { status: 409, code: 'CONFLICT_STATE' },
  [E.returnNoteRequired]: { status: 400, code: 'VALIDATION_FAILED' },
}
