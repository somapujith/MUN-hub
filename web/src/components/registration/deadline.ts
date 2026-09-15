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
