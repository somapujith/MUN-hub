/**
 * Clock reads for the registration funnel, kept out of component bodies.
 *
 * `Date.now()` is an impure call: React's purity rule (and the
 * `react-hooks/purity` lint) rightly rejects it inside a render, because a
 * component that reads the wall clock while rendering can produce different
 * output for the same props. In *server* components the read is legitimate —
 * these pages must know whether a 15-minute seat hold has lapsed — so the call
 * lives here, in plain module scope, where it is an ordinary function rather
 * than part of a render.
 *
 * Client components must NOT call these during render. They receive the
 * already-resolved boolean from the server and only re-read the clock inside
 * effects (see `ReservationCountdown`), which keeps server and client markup
 * identical at hydration.
 *
 * (Lives here rather than in `lib/` because `lib/` is owned by the backend
 * session and frozen for this change.)
 */

/** True if `deadline` is in the past. A null deadline never expires. */
export function hasPassed(deadline: Date | null): boolean {
  if (deadline === null) return false;
  return deadline.getTime() <= Date.now();
}

/**
 * Whether a delegate can start registering for this MUN, mirroring both
 * checks `lib/actions/registration.ts#initiateRegistration` makes before it
 * ever looks at a specific pass: the mun must be open, and — separately from
 * any per-pass `registrationProducts.deadline` — its own overall
 * `registrationDeadline` must not have passed. A mun's status is admin-set
 * and doesn't flip to REGISTRATION_CLOSED on its own the moment the deadline
 * lapses, so without this check the marketplace/detail/registration pages
 * kept offering "Register now" (and let a delegate fill in the whole funnel)
 * right up until the server's own deadline check rejected the final submit.
 */
export function canRegisterForMun(mun: { status: string; registrationDeadline: Date | null }): boolean {
  return mun.status === "REGISTRATION_OPEN" && !hasPassed(mun.registrationDeadline);
}
