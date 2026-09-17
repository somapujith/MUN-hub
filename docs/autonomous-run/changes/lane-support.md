# Lane `support` — support chat, inboxes and staff console

Lead: mun-hub-62. Scope: `lib/actions/support.ts` (+ tests), `server/routes/support.ts` (+ integration test), `web/src/api/support.ts`, `web/src/types/support.ts`, `web/src/components/support/**`, the four support pages, and the Support item in the header account menu. The user reported: "the support chat option is bugged — implement that module properly and cleanly in all aspects."

Worktree branch `worktree-agent-abd80b12ad59cf7eb`, fast-forwarded to `main` at `4ea2776` before starting. That picked up mun-hub-4b's `notifySupportReply` wiring, which is kept as is.

## How the defects were found

I read the whole module, then drove it in Chrome with Playwright. The API ran on :3111 and web on :5211, both against local Docker (`.env.test`). Signed-out, delegate, organizer and admin sessions were covered at desktop and 390px widths. I recorded network traffic, console errors, focus and live regions, then compared the API's answers with the database.

## Defects (symptom → root cause → fix)

### Conversation model and state machine (lib + API)

1. **Tickets from `/support/new` (and API tickets) had an empty thread.** The inbox showed nothing, and the admin page said "No messages yet." while the text sat on the card.
   - Cause: `createTicket` wrote only `support_tickets.description`, and the chat read only `support_messages`. There were two parallel models.
   - Fix: every entry point writes the ticket and its opening message in one transaction. The UI shows the description as the first bubble for legacy rows that have no messages.
2. **Replies never moved the ticket.** A staff reply left a ticket NEW and unassigned. A requester reply to a RESOLVED ticket left it resolved and invisible in the open queue. WAITING never flipped back.
   - Cause: `sendMessage` deliberately didn't touch the status.
   - Fix: a staff reply assigns a NEW ticket to the replier (audited as TICKET_ASSIGNED) and leaves it WAITING, or IN_PROGRESS when the staff member picks "keep in progress".
   - A requester reply moves WAITING or RESOLVED to IN_PROGRESS. Reopening clears the stale resolution note.
   - A staff reply on a RESOLVED ticket keeps it resolved. CLOSED rejects both sides with a 409.
3. **`assignTicket` bypassed the state machine.** Assigning a CLOSED or RESOLVED ticket reopened it as ASSIGNED. Taking over an IN_PROGRESS or WAITING ticket knocked it back to ASSIGNED. An unknown id returned `200 null` and still wrote an audit row.
   - Cause: an unconditional `UPDATE … SET status='ASSIGNED'` with no row lock or existence check.
   - Fix: the ticket row is locked. RESOLVED and CLOSED return a 409, unknown ids return a 404, and taking over keeps the status. Re-assigning to the same person is a no-op with no duplicate audit row.
4. **`PATCH status=ASSIGNED` on a NEW ticket left it ASSIGNED with nobody assigned.**
   - Fix: ASSIGNED is reachable only through `/assign`. The PATCH schema accepts only IN_PROGRESS, WAITING, RESOLVED and CLOSED. A ticket with no owner is assigned to whoever moves it.
5. **A ticket could be resolved without a note.** Only the UI required one.
   - Fix: the lib requires a trimmed note of at most 2000 characters ("A resolution note is required", a 400).
6. **No length limits.** A 200,000-character message was accepted, and one long description stretched the admin page to 1.5M px wide at 390px.
   - Fix: strict zod schemas (subject 150, message 5000, note 2000, search 100), the same limits in the lib, and `overflow-wrap:anywhere` in the UI.
7. **`relatedMunId` and `relatedRegistrationId` were not ownership-checked.** An organizer could attach any MUN, or another user's registration, to a ticket.
   - Fix: organizers may reference only their own MUNs, or registrations for them. Delegates may reference only their own registrations, or MUNs they registered for. Staff may reference anything that exists. Otherwise the request fails with a 403 or 404.
8. **Lists were unbounded.** The admin page rendered all 1,253 local tickets (26.9k DOM nodes). `listMyConversations` sorted in JS.
   - Fix: `{ results, total }` pagination in SQL, ordered by `coalesce(last_message_at, created_at) desc, id desc`.
9. **Requesters received staff-side fields** (`assignedTo`, `adminReadAt`, staff user ids).
   - Fix: requesters get a requester view. Staff messages show as "MUN Hub support" with `senderId: null`. Staff get a staff view with requester name, email and role, assignee name and related MUN name. Both views carry a server-computed `unread`.
10. **Refund was an accepted category** even though the product has no refunds.
    - Fix: `REQUESTER_CATEGORIES` excludes REFUND. The enum value stays for legacy rows and appears as a filter only.
11. **Concurrent replies could be ordered wrongly.**
    - Fix: message `created_at` is `clock_timestamp()` taken after the ticket row lock, with `id` as the tiebreaker.

### Widget and inboxes (web)

12. **The unread dot and badge never cleared after reading.**
    - Cause: the mark-read mutation didn't touch the list or badge caches. The list query was disabled in thread view, so its stale data came back.
    - Fix: `useMarkReadWhenViewed` patches every cached list and invalidates both badges. It runs only when something is actually unread.
13. **An expired session kept polling.** The widget sent a 401 every 4s for the thread plus the badge poll, and the header still looked signed in.
    - Cause: the support client threw status-less `Error`s. The shared retry rule treated them as retryable, and nothing invalidated the session.
    - Fix: `SupportApiError` carries the status, so there are no retries on 4xx. A 401 re-checks `/auth/session`, the widget switches to the sign-in prompt, and polling stops (verified: zero support requests afterwards).
14. **Errors raised a toast on every failed poll.**
    - Fix: queries show inline error or "Reconnecting…" states. Toasts are for user actions only.
15. **Newlines in messages were collapsed.**
    - Fix: `whitespace-pre-wrap`.
16. **The widget panel was cramped** at phone width, and bubble and textarea text rendered at 16px.
    - Cause: the sheet body was a row flex without `w-full`. `cn()` dropped `text-body-md` because a colour class followed it.
    - Fix: a column layout, and plain class strings wherever a size token and a colour meet.
17. **`/organizer/support` rendered for signed-out visitors,** with a spinner forever and 401 requests.
    - Cause: `RequireRole` alone passes children through when there is no session.
    - Fix: `RequireOrganizer` (auth, then role).
18. **`/support/new` had several problems.** It offered Refund, promised an email follow-up, and ended on "Ticket submitted" with "Back to dashboard", which always went to `/dashboard`, even for organizers.
    - Fix: no Refund, the right copy, and after filing it opens the new conversation (`/dashboard/support?ticket=…` or `/organizer/support?ticket=…`, cross-host safe). Organizers can pick one of their MUNs.
19. **The floating bubble duplicated the full-page inbox,** and signed-out visitors had no support entry point.
    - Fix: the bubble is hidden on the inbox pages, `/support/new` and `/admin/*`. Signed-out visitors get a sign-in prompt (delegate sign-in, create account, organizer sign-in, support email) and no API calls.
20. **Polish and accessibility gaps.** Status labels were raw enums. No live region announced new messages. The composers had placeholder-only names. Enter-to-send worked in the reply box but not the start box. Sends weren't optimistic. Any new message yanked the scroll position, even for a reader scrolled up in the history. The "Open full inbox" link used `<Link>` across hosts.
    - Fix: one shared `MessageThread`:
      - Scroll sticks to the bottom only when the reader is already there, and a "New messages" button appears otherwise.
      - A polite live region announces only incoming messages.
      - The scroll area is focusable.
    - One shared `MessageComposer`:
      - It has a visually hidden label.
      - Enter sends and Shift+Enter adds a line. On touch devices Enter adds a line and the button sends.
      - The IME is guarded, the box is read-only while sending, a counter appears near the limit, and double Enter sends once.
    - An optimistic pending bubble lives outside the query cache. On failure it is removed and the draft restored.
    - Human status labels. Organizers see "Waiting on you", staff see "Waiting on requester".
    - A `ZoneLink` handles cross-host links.
21. **The staff thread marked a conversation read only once per expansion,** used the list row's stale status, and had no Close or Reopen actions. The admin unread endpoint was never used.
    - Fix: the staff console (below).
22. **The list beside an open thread lagged behind it** (e.g. "Received" next to "Waiting on you").
    - Fix: the thread poll copies status and activity into the cached lists.
23. **Admin filters could undo each other.** Two quick filter changes lost the first one.
    - Cause: React Router's functional `setSearchParams` starts from the last-rendered params.
    - Fix: build the next params from `window.location.search`.

### Staff console (`/admin/support`)

- The queue and the selected ticket sit side by side from `lg`, and one at a time on phones. Pages hold 25 tickets.
- Filters: status (default "Open", i.e. not resolved), category, priority and assignee (me / unassigned). Search matches subject, requester name or email, or ticket id, with a 300ms debounce. All of it lives in the URL.
- Queue rows show unread markers, and the header shows an "N awaiting a reply" count.
- The ticket view shows requester details (name, role, mailto email), related MUN, owner, opened date and ticket id.
- Actions: Assign to me / Take over, Mark in progress, Waiting on requester, Resolve (dialog, note required), Reopen, and Close (confirmation dialog). The resolve and close dialogs are separate, so the content doesn't flip mid-animation.
- A staff member's own messages read "You", and other staff show by name.

## Decisions

- **State machine:** NEW→ASSIGNED; ASSIGNED→IN_PROGRESS|WAITING; IN_PROGRESS→WAITING|RESOLVED; WAITING→IN_PROGRESS|RESOLVED; RESOLVED→IN_PROGRESS (reopen)|CLOSED; CLOSED terminal.
  - NEW→CLOSED stays illegal, which the existing E2E expects to return 409.
  - A requester reply reopens a RESOLVED ticket. CLOSED is final, and the requester starts a new conversation instead.
  - TICKET_RESOLVED is audited on every resolve, since a ticket can now be resolved again after a reopen.
- **Default staff-reply effect is WAITING** ("ball in the requester's court"), with an explicit "Then keep in progress" choice in the composer.
- **Read state uses the existing `requester_read_at` / `admin_read_at` columns** (no localStorage). Staff read state is shared across staff, as before.
- **Polling runs only while mounted and the tab is visible** (`refetchIntervalInBackground: false`). The open thread polls every 5s, a visible list every 15s, the staff queue and awaiting count every 30s, and the widget badge every 60s, only while the widget is closed. Measured: zero list or thread requests while closed or hidden.
- **403, not 404, for someone else's ticket.** This matches the existing E2E. Ids are UUIDs, so this isn't an enumeration risk.
- **Staff can file tickets and see them in the staff view.** Staff visiting `/dashboard/support` or `/support/new` are sent to `/admin/support`. Organizers visiting `/dashboard/support` go to `/organizer/support`.
- **The organizer inbox keeps the site-header layout.** Putting it inside the workspace shell showed a wrong "Overview" breadcrumb, and that component belongs to the organizer lane.
- **No rate limiting added.** The only per-route mechanism is `server/middleware/rate-limit.ts`, which this lane must not touch.
- **`listTickets` is kept unchanged** for `lib/actions/admin-audit.ts` (the overview count). `listTicketsWithRequester` was replaced by `listStaffTickets`.
- **Staff-reply email:** `notifySupportReply(ticketId)` is still called after commit, for staff replies only, exactly as mun-hub-4b wired it.

## API changes (for other lanes and E2E)

- `GET /support/conversations?limit&offset` now returns `{ results, total }` (was an array).
- `GET /admin/support/tickets` accepts `status` (a status or `OPEN`), `category`, `priority`, `assignee=me|unassigned`, `q`, `limit` (max 100) and `offset`, and returns `{ results, total }` (was an array). Unknown query keys return 400.
- `GET /support/conversations/:id` returns `{ viewer: 'REQUESTER'|'STAFF', ticket, messages }`. Messages carry `author`; `senderId` is null for staff messages in the requester view.
- `POST /support/conversations/:id/messages` accepts `{ body, nextStatus? }` (`nextStatus` is staff-only; a requester sending it gets 403) and returns `{ message, ticket }` (was the message).
- `POST /support/conversations` also accepts `relatedMunId`.
- `POST /support/tickets` and `POST /support/conversations` reject REFUND, over-long text and unknown keys with 400.
- `PATCH /admin/support/tickets/:id` accepts only IN_PROGRESS, WAITING, RESOLVED or CLOSED. RESOLVED requires `resolutionNotes`, otherwise 400.
- `POST /admin/support/tickets/:id/assign` returns 404 for an unknown id and 409 for a RESOLVED or CLOSED ticket.

## Verification

- `npx vitest run lib/actions/support.test.ts lib/actions/support-notifications.test.ts lib/notifications/support-reply-email.test.ts server/integration/support-chat.integration.test.ts server/integration/error-taxonomy.test.ts --no-file-parallelism`: **5 files, 57 tests, all pass.** `support.test.ts` was rewritten: 39 tests covering the state machine, authorization, ownership checks, pagination and filters, unread state, and racing replies. `support-chat.integration.test.ts` was rewritten: 9 route tests covering auth everywhere, strict validation, privacy, and the full lifecycle over HTTP.
- `cd server && npx tsc --noEmit -p tsconfig.json`: clean. Root `tsc` shows no errors in support files.
- `cd web && npx tsc -b --noEmit`: clean. `npx oxlint` on every changed web path: 0 warnings. `vite build` (to a scratch dir): OK.
- Browser, Playwright with Chrome (scripts kept outside the repo): **90/90 checks pass.**
  - Signed-out prompt with no API calls, and the organizer inbox guard.
  - Widget: focus on open, focus trapped inside and returned on close, Enter and Shift+Enter, optimistic send with a single POST on a double Enter, staff reply arriving by poll and announced in the live region.
  - Polling: about 5s for the open thread, none while closed, none while the tab is hidden.
  - Unread badge and dot set, then cleared immediately after reading.
  - Failed send restores the draft. Resolve and reopen as seen by the delegate. Session expiry stops polling.
  - `/support/new` without Refund, landing on the new thread. Mobile inbox, where Enter adds a line on touch.
  - Organizer MUN picker, `?ticket=` deep link and account-menu link. Staff sent from `/dashboard/support` to the queue.
  - Admin: pagination, search, filters in combination, unread clearing, assign, in progress, reply with either next status, requester reply reopening, resolve with a required note, close, 30s queue polling, and no horizontal scroll at 390px for the list or the ticket.
  - Dark mode inbox checked visually.

## Follow-ups

- **E2E (mun-hub-84):** the support specs need updating for the new behaviour.
  - `student/support.spec.ts`:
    - After submitting, expect navigation to `/dashboard/support?ticket=…` and the thread, not "Ticket submitted." and "Back to dashboard".
    - The status label is now "Received", not "NEW".
    - On desktop the inbox is two-pane; "Back to conversations" shows only below `lg`.
    - "The widget is not offered to signed-out visitors" is now "signed-out visitors get a sign-in prompt".
  - `organizer/support.spec.ts`:
    - `GET support/conversations` returns `{ results, total }`.
    - The message text appears three times (list row, heading, bubble).
    - Thread bubbles are `li` elements too, so scope list lookups to the region named "Your conversations".
    - No back button on desktop.
  - `admin/support.spec.ts`: rewrite for the queue and ticket layout.
    - Rows are buttons in the region named "Ticket queue", and the ticket is the region named "Selected ticket".
    - Labels are human-readable ("New", "Delegate", "Payment", "Urgent").
    - The form ticket's description is the first message, so "No messages yet." no longer appears.
    - The staff label is "You".
    - The default filter is "Open (not resolved)".
    - Toasts ("Ticket assigned to you", "Ticket marked in progress", "Ticket resolved") and the resolve dialog names are unchanged.
  - `student/role-boundaries.spec.ts`: `/organizer/support` now shows the organizer-only reason (`ORGANIZER_REASON`), not `ADMIN_REASON`.
- **mun-hub-4b:** `lib/notifications/support-reply-email.ts` can now deep-link to the conversation with `…/support?ticket=<id>`. Its comment says no per-ticket route exists, which is no longer true.
- **Payments lane:** also planned to drop Refund from `support-form.tsx`. That file was rewritten here, so take this version on merge.
- **Admin or organizer lanes:** add "Support" to the organizer workspace nav and breadcrumb, then the inbox can move inside the workspace shell. `lib/actions/admin-audit.ts` could count open tickets with `listStaffTickets({ status: 'OPEN', limit: 1 }).total` instead of loading every ticket through `listTickets`.
- **sec-auth lane (rate limiting):** consider rules for `POST /support/tickets` and `POST /support/conversations` (e.g. 10 per hour per user) and `POST /support/conversations/:id/messages` (e.g. 30 per minute per user).
- **Schema, needs a migration slot:** internal staff notes need a visibility flag on `support_messages`. Per-staff read state would need its own table. A `(created_by, last_message_at)` index would help the requester list at scale.
- **Shared `Sheet` (base-ui):** with instantaneous synthetic Tab presses, focus can briefly slip past the focus guard. At human pace (≥60ms between presses) it stays trapped. Worth a look by whoever owns `components/ui`.
- **Local data:** the local DB has more than 1,300 junk support tickets from test runs. They're harmless and show up in the admin queue.
