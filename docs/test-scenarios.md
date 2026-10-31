# EventHub — Booking Management Test Scenarios

Generated: 2026-10-30
Scope: Booking management — create booking (as it affects bookings), view list, view detail, cancel, clear all, lookup by reference, refund eligibility, FIFO cap, per-user seats, cross-user isolation.

Sources: `eventhub-domain` skill (`business-rules.md`, `user-flows.md`), `frontend/app/bookings/**`, `frontend/app/events/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/lib/api/*`, `backend/src/{routes,validators,controllers,services,repositories}/booking*`, `backend/src/middleware/errorHandler.js`.

## Code findings to confirm (likely defects)
These came from reading the code. Each one has a scenario below that checks whether it really happens.

| # | Finding | Scenario |
|---|---|---|
| F1 | "Clear all bookings" calls `lib/api/bookings.ts` → `client.ts` (`fetch`), which sends **no `Authorization` header**. The backend should return 401, the error is swallowed (`try/finally`, no `catch`), and the bookings stay. | TC-109, TC-309 |
| F2 | `cancelBooking` looks the booking up with `findById(id, userId)`, so another user's booking returns **404, not 403**. The `ForbiddenError` branch can never run. | TC-202 |
| F3 | The FIFO prune runs **before** the event-exists and seat checks. If a booking fails with 404 or 400 while the user is at the 9-booking cap, the oldest booking is still deleted. | TC-410, TC-411 |
| F4 | The same-event FIFO fallback permanently decrements `availableSeats` in the database. For a **static** event this changes the shared seat count for every user. | TC-101, TC-206 |
| F5 | `withPersonalSeats` subtracts the user's booked quantity from **every** event, static ones included. `business-rules.md` says static events use a fixed field. | TC-108 |
| F6 | `business-rules.md` §5 promises a sandbox banner on the bookings page. No such banner exists in `bookings/page.tsx`. | TC-511 |
| F7 | A non-numeric booking id (`/api/bookings/abc`) becomes `Number('abc') = NaN` before reaching Prisma. This probably returns 500, not 400 or 404. | TC-311 |
| F8 | No maximum length on `customerName`, `customerEmail` or `customerPhone`. Prisma `String` is VARCHAR(191) in MySQL, so long values probably cause a 500. | TC-412 |

---

## Happy Path

### TC-001: View bookings list with existing bookings
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User logged in; user has ≥1 booking
**Steps**:
1. Navigate to `/bookings`
**Expected Results**: Heading "My Bookings". One `[data-testid="booking-card"]` per booking, newest first (`createdAt desc`). Each card shows the booking ref, a "confirmed" badge, `#<id>` (`booking-id`), event title, event date, "N ticket(s)", city, booked date, total price, a "View Details" link and a "Cancel Booking" button.
**Business Rule**: Flow 4 — Manage Bookings
**Suggested Layer**: E2E

### TC-002: Create a booking and see it in My Bookings
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User logged in; static event with seats available
**Steps**:
1. Open `/events/:id`
2. Fill Full Name, Email, Phone; keep quantity 1
3. Click "Confirm Booking"
4. Click "View My Bookings" on the confirmation card
**Expected Results**: The confirmation card shows the booking ref and ticket count. `/bookings` lists the new booking at the top with the same ref.
**Business Rule**: §1 User Journey
**Suggested Layer**: E2E

### TC-003: View booking detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User has a booking
**Steps**:
1. On `/bookings`, click "View Details" on a card
**Expected Results**: URL is `/bookings/:id`. Breadcrumb reads "My Bookings / <ref>". The header shows the ref, a "confirmed" badge and the event title. These sections are filled in: Event Details (event, category, date, venue, city), Customer Details (name, email, phone), Payment Summary (tickets, price per ticket, total paid), Refund, and Booking Information (booked on, `#id`).
**Business Rule**: Flow 4 step 3–4
**Suggested Layer**: E2E

### TC-004: Cancel a booking from the bookings list card
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User has ≥1 booking
**Steps**:
1. On `/bookings`, click `cancel-booking-btn` on a card
2. In the dialog "Cancel this booking?", click "Yes, cancel it" (`confirm-dialog-yes`)
**Expected Results**: Toast "Booking cancelled successfully". The card disappears from the list and the count drops by 1.
**Business Rule**: §1 — user can cancel individual bookings
**Suggested Layer**: E2E

### TC-005: Cancel a booking from the detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: User has a booking
**Steps**:
1. Open `/bookings/:id`
2. Click "Cancel Booking", then "Yes, cancel it"
**Expected Results**: Toast "Booking cancelled successfully"; redirect to `/bookings`; the booking is no longer listed.
**Business Rule**: §1 / Flow 4 step 6
**Suggested Layer**: E2E

### TC-006: Clear all bookings
**Category**: Happy Path
**Priority**: P1
**Preconditions**: User has ≥2 bookings
**Steps**:
1. On `/bookings`, click "Clear all bookings"
2. Accept the native browser `confirm()` dialog ("Clear all your bookings? This cannot be undone.")
**Expected Results**: All bookings are removed and the empty state "No bookings yet" shows. API equivalent: `DELETE /api/bookings` → 200 `{ message: "N booking(s) cleared" }`. *(See TC-109: F1 suggests this fails in the UI.)*
**Business Rule**: §4 — "Clear All Bookings" removes all in one go
**Suggested Layer**: E2E + API

### TC-007: Navigate back to the list from the detail page
**Category**: Happy Path
**Priority**: P3
**Preconditions**: On `/bookings/:id`
**Steps**:
1. Click "← Back to My Bookings" (repeat using the "My Bookings" breadcrumb link)
**Expected Results**: Both links go to `/bookings`.
**Business Rule**: Flow 4
**Suggested Layer**: E2E

### TC-008: Look up a booking by reference (API)
**Category**: Happy Path
**Priority**: P1
**Preconditions**: User owns a booking with ref R
**Steps**:
1. `GET /api/bookings/ref/R` with the owner's token
**Expected Results**: 200, `{ success: true, data: { bookingRef: R, event: {...} } }`
**Business Rule**: API reference — booking by ref
**Suggested Layer**: API

### TC-009: List bookings via API with pagination metadata
**Category**: Happy Path
**Priority**: P1
**Preconditions**: User has N bookings
**Steps**:
1. `GET /api/bookings?page=1&limit=10`
**Expected Results**: 200 with `data` (only this user's bookings, each with `event` included) and `pagination: { total: N, page: 1, limit: 10, totalPages: ceil(N/10) }`.
**Business Rule**: §2 Sandbox isolation
**Suggested Layer**: API

---

## Business Rules

### TC-100: FIFO — the 10th booking prunes the oldest booking from a different event
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User has exactly 9 bookings; the oldest is for event A
**Steps**:
1. Create a booking for event B (≠ A)
**Expected Results**: 201. The user still has 9 bookings. The oldest booking (event A) is gone and the new booking is first in the list.
**Business Rule**: §4 — max 9 bookings, FIFO
**Suggested Layer**: API (+1 E2E smoke)

### TC-101: FIFO same-event fallback permanently burns seats
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User has 9 bookings, all for event X; note X's `availableSeats` (DB value)
**Steps**:
1. Book event X again with quantity Q
2. `GET /api/events/X`
**Expected Results**: Still 9 bookings (the oldest X booking is pruned). The DB `availableSeats` for X has dropped by Q, so the personal count still decreases even though one booking was removed.
**Business Rule**: Code: `bookingService.createBooking` same-event fallback (F4)
**Suggested Layer**: API

### TC-102: Booking ref starts with the event title's first character (uppercase)
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Static event, e.g. "Tech Conference Bangalore"
**Steps**:
1. Book it; read `booking-ref` on the confirmation card, the list card and the detail breadcrumb
**Expected Results**: The ref matches `/^T-[A-Z0-9]{6}$/` and is identical in all three places.
**Business Rule**: §7 Booking reference format
**Suggested Layer**: E2E (format: API)

### TC-103: Refund — a single-ticket booking is eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Booking with quantity 1
**Steps**:
1. Open the detail page; click `check-refund-btn`
**Expected Results**: `refund-spinner` shows "Checking your refund eligibility…". Then `refund-result` shows "Eligible for refund. Single-ticket bookings qualify for a full refund." with green styling.
**Business Rule**: §8 Refund eligibility
**Suggested Layer**: E2E (logic: Component)

### TC-104: Refund — a multi-ticket booking is not eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Booking with quantity 3
**Steps**:
1. Open the detail page; click `check-refund-btn`
**Expected Results**: After the spinner, `refund-result` shows "Not eligible for refund. Group bookings (3 tickets) are non-refundable." with red styling.
**Business Rule**: §8
**Suggested Layer**: E2E (logic: Component)

### TC-105: Refund spinner lasts about 4 seconds
**Category**: Business Rule
**Priority**: P2
**Preconditions**: On a booking detail page
**Steps**:
1. Click `check-refund-btn`; measure how long until `refund-result` appears
**Expected Results**: The spinner is visible right away; the result appears after ~4000 ms (and not before ~3.5 s). The test needs an `expect` timeout above 5 s.
**Business Rule**: §8 — 4-second spinner
**Suggested Layer**: Component (fake timers); E2E with an extended timeout

### TC-106: Total price = event price × quantity
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Event with price P
**Steps**:
1. Book quantity 3; check the form's running total, the API `totalPrice` and the detail page's "Total Paid"
**Expected Results**: All three equal 3 × P. The UI formats it as USD with no decimals (`maximumFractionDigits: 0`).
**Business Rule**: §9 Price calculation
**Suggested Layer**: API + E2E

### TC-107: Booking reduces the user's available seats immediately
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Event detail shows `S / total` seats
**Steps**:
1. Book quantity Q
2. Reload `/events/:id`
**Expected Results**: Seats show `S − Q`. The events list card shows the same.
**Business Rule**: §1 / §6 Per-user seat availability
**Suggested Layer**: E2E

### TC-108: Cancelling a booking restores the user's available seats (static and dynamic events)
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User has a booking of quantity Q on a static event and on a self-created event
**Steps**:
1. Note the seats shown for each event
2. Cancel both bookings
3. Re-open both events
**Expected Results**: Each event's seats rise by Q. The static event's DB `availableSeats` is unchanged; the count is recomputed per user (F5 — the code applies personal seats to static events too, unlike what the docs say).
**Business Rule**: §4 cancellation frees seats; §6
**Suggested Layer**: API (+E2E for one event)

### TC-109: "Clear all bookings" actually deletes bookings in the UI
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User has ≥1 booking
**Steps**:
1. Click "Clear all bookings" and accept the confirm dialog
2. Watch the network request for `DELETE /api/bookings`
3. Reload `/bookings`
**Expected Results**: The request includes `Authorization: Bearer <token>`, returns 200, and the list is empty after reload. **Suspected failure (F1)**: the request goes out without a token and returns 401, nothing is deleted, and no error is shown.
**Business Rule**: §4 Clear All
**Suggested Layer**: E2E

### TC-110: Only this user's bookings are listed
**Category**: Business Rule
**Priority**: P0
**Preconditions**: User A and User B each have bookings
**Steps**:
1. Log in as A; `GET /api/bookings` and view `/bookings`
**Expected Results**: Only A's bookings appear. `pagination.total` counts A's bookings only.
**Business Rule**: §2 Sandbox isolation
**Suggested Layer**: API

### TC-111: The same user can book the same event several times
**Category**: Business Rule
**Priority**: P2
**Preconditions**: Event with enough seats
**Steps**:
1. Book event X twice (quantities 2 and 3)
**Expected Results**: Two separate bookings with different refs. Personal seats drop by 5 in total.
**Business Rule**: §6 — allows rebooking the same event for testing
**Suggested Layer**: API

### TC-112: Deleting a user-created event deletes its bookings (cascade)
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User created event E and booked it
**Steps**:
1. Delete E from `/admin/events`
2. Open `/bookings` and `GET /api/bookings/:bookingId`
**Expected Results**: The booking is gone from the list; the API returns 404.
**Business Rule**: Flow 5 — delete cascades to bookings; Prisma `onDelete: Cascade`
**Suggested Layer**: API

### TC-113: FIFO pruning of a user-created event removes its bookings
**Category**: Business Rule
**Priority**: P2
**Preconditions**: User has 6 dynamic events; the oldest (E1) has a booking
**Steps**:
1. Create a 7th event
**Expected Results**: E1 is pruned and its booking disappears from `/bookings`.
**Business Rule**: §3 Event FIFO + cascade
**Suggested Layer**: API

---

## Security

### TC-200: Viewing another user's booking shows "Access Denied" (UI)
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns booking id N
**Steps**:
1. Log in as User B (other test account)
2. Navigate to `/bookings/N`
**Expected Results**: Empty state "Access Denied" — "You are not authorized to view this booking." — with a "View My Bookings" button. None of A's details are shown.
**Business Rule**: §2 / Flow 6 Cross-user security
**Suggested Layer**: E2E

### TC-201: GET another user's booking by id → 403
**Category**: Security
**Priority**: P0
**Preconditions**: A owns booking N
**Steps**:
1. `GET /api/bookings/N` with B's token
**Expected Results**: 403 `{ success: false, error: "You are not authorized to view this booking" }`; no booking data in the body.
**Business Rule**: §2
**Suggested Layer**: API

### TC-202: Cancelling another user's booking does not delete it
**Category**: Security
**Priority**: P0
**Preconditions**: A owns booking N
**Steps**:
1. `DELETE /api/bookings/N` with B's token
2. `GET /api/bookings/N` with A's token
**Expected Results**: Step 1 fails and step 2 still returns the booking. Check the status code: the domain rule implies 403, but the code (F2) returns **404 "Booking with id N not found"**. Record which one happens and confirm the expected value with the product owner.
**Business Rule**: §2 cross-user access → 403
**Suggested Layer**: API

### TC-203: Looking up another user's booking by ref → 403
**Category**: Security
**Priority**: P1
**Preconditions**: A owns ref R
**Steps**:
1. `GET /api/bookings/ref/R` with B's token
**Expected Results**: 403 "You do not own this booking". Note: a 403 here (vs a 404 for unknown refs) tells the caller the ref exists.
**Business Rule**: §2
**Suggested Layer**: API

### TC-204: "Clear all" only deletes the caller's bookings
**Category**: Security
**Priority**: P0
**Preconditions**: A and B both have bookings
**Steps**:
1. `DELETE /api/bookings` with A's token
2. `GET /api/bookings` with B's token
**Expected Results**: A has 0 bookings; B's bookings are untouched.
**Business Rule**: §2
**Suggested Layer**: API

### TC-205: Booking endpoints need a valid JWT
**Category**: Security
**Priority**: P0
**Preconditions**: None
**Steps**:
1. Call each of `GET /api/bookings`, `GET /api/bookings/1`, `GET /api/bookings/ref/X-123456`, `POST /api/bookings`, `DELETE /api/bookings`, `DELETE /api/bookings/1` with (a) no header, (b) `Authorization: Token abc`, (c) a malformed or tampered JWT, (d) an expired JWT
**Expected Results**: (a, b) → 401 "Unauthorized"; (c, d) → 401 "Invalid or expired token".
**Business Rule**: Auth middleware; JWT 7-day expiry
**Suggested Layer**: API

### TC-206: One user's same-event FIFO fallback on a static event changes the seats another user sees
**Category**: Security
**Priority**: P1
**Preconditions**: B notes the seats on static event X. A has 9 bookings, all on X.
**Steps**:
1. A books X again (quantity Q)
2. B reloads X
**Expected Results**: Per the sandbox rules, B's view should **not** change. The code (F4) decrements the shared DB column, so B probably sees Q fewer seats. If confirmed, this breaks both sandbox isolation and "static events are immutable".
**Business Rule**: §2 Sandbox isolation; static events immutable
**Suggested Layer**: API

### TC-207: Booking another user's dynamic event → 404
**Category**: Security
**Priority**: P1
**Preconditions**: B created event E
**Steps**:
1. `POST /api/bookings { eventId: E, ... }` with A's token
**Expected Results**: 404 "Event with id E not found". No booking is created.
**Business Rule**: §2 — users only see their own dynamic events
**Suggested Layer**: API

### TC-208: The bookings list redirects a logged-out user
**Category**: Security
**Priority**: P1
**Preconditions**: No `eventhub_token` in localStorage
**Steps**:
1. Navigate directly to `/bookings` and to `/bookings/1`
**Expected Results**: Redirected to `/login` (AuthGuard, or the axios 401 interceptor). No booking data appears.
**Business Rule**: Auth required
**Suggested Layer**: E2E

### TC-209: A request body cannot override userId, price or ref
**Category**: Security
**Priority**: P1
**Preconditions**: User A logged in
**Steps**:
1. `POST /api/bookings` with valid fields plus `userId: <B's id>`, `totalPrice: 1`, `bookingRef: "Z-AAAAAA"`, `status: "cancelled"`
**Expected Results**: 201. The booking belongs to A; `totalPrice` = price × qty; the ref is generated from the title; status is "confirmed".
**Business Rule**: §7, §9; service builds payload explicitly
**Suggested Layer**: API

### TC-210: Customer fields are shown as plain text, not run as HTML
**Category**: Security
**Priority**: P2
**Preconditions**: None
**Steps**:
1. Book with `customerName: "<img src=x onerror=alert(1)>"`
2. Open the detail page
**Expected Results**: The name shows as literal text; no script runs.
**Business Rule**: Discovered — React escaping
**Suggested Layer**: E2E

---

## Negative / Error

### TC-300: Non-existent booking id shows "Booking not found"
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Navigate to `/bookings/99999999`
**Expected Results**: Empty state "Booking not found" — "This booking doesn't exist or may have been cancelled." — with a "View My Bookings" button.
**Business Rule**: Flow 4; detail page error state
**Suggested Layer**: E2E

### TC-301: GET/DELETE a non-existent booking id → 404
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. `GET /api/bookings/99999999`; `DELETE /api/bookings/99999999`
**Expected Results**: 404 "Booking with id 99999999 not found".
**Business Rule**: errorHandler NotFoundError → 404
**Suggested Layer**: API

### TC-302: Unknown booking ref → 404
**Category**: Negative
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. `GET /api/bookings/ref/Q-ZZZZZZ`
**Expected Results**: 404 `Booking with reference "Q-ZZZZZZ" not found`.
**Business Rule**: errorHandler
**Suggested Layer**: API

### TC-303: Booking more seats than available → 400
**Category**: Negative
**Priority**: P0
**Preconditions**: Event with personal available seats S < 10 (e.g. a self-created event with 3 seats)
**Steps**:
1. `POST /api/bookings` with quantity S+1
**Expected Results**: 400 "Only S seat(s) available, but S+1 requested". No booking is created.
**Business Rule**: §6 seat availability
**Suggested Layer**: API

### TC-304: Booking a non-existent event → 404
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. `POST /api/bookings` with `eventId: 99999999`
**Expected Results**: 404 "Event with id 99999999 not found".
**Business Rule**: bookingService event check
**Suggested Layer**: API

### TC-305: Missing required fields → 400 with per-field details
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. `POST /api/bookings` with `{}`
**Expected Results**: 400 `{ error: "Validation failed", details: [...] }` with entries for eventId, customerName, customerEmail, customerPhone and quantity ("... is required").
**Business Rule**: bookingValidator
**Suggested Layer**: API

### TC-306: Invalid quantity values → 400
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Send quantity = 0, -1, 11, 2.5, "abc"
**Expected Results**: Each → 400 "Quantity must be an integer between 1 and 10". (`"5"` as a string is accepted and converted to an integer.)
**Business Rule**: Data model: quantity 1–10
**Suggested Layer**: API (Unit for the validator)

### TC-307: Invalid customer fields → 400
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Name "A" or "   " (spaces only); email "not-an-email"; phone "12345", "abcdefghij", "98765@4321"; eventId 0 / -5 / "x"
**Expected Results**: 400 with these messages: "Customer name must be at least 2 characters" / "is required"; "must be a valid email address"; "must be at least 10 digits" / "must contain only digits and +, -, spaces, or parentheses"; "Event ID must be a positive integer".
**Business Rule**: Data model: name ≥2, valid email, phone ≥10
**Suggested Layer**: API

### TC-308: Cancelling an already-cancelled booking → 404
**Category**: Negative
**Priority**: P2
**Preconditions**: Booking N was cancelled
**Steps**:
1. `DELETE /api/bookings/N` again; open `/bookings/N`
**Expected Results**: API 404; the UI shows "Booking not found".
**Business Rule**: Cancellation is a hard delete
**Suggested Layer**: API

### TC-309: "Clear all" failure is shown to the user
**Category**: Negative
**Priority**: P1
**Preconditions**: Force `DELETE /api/bookings` to return 500 (route mock), or rely on F1's 401
**Steps**:
1. Click "Clear all bookings" and accept
**Expected Results**: The user should see an error. The current code has no `catch` and no toast, so the button just goes back from "Clearing…" to "Clear all bookings" with no message. Record this as a UX defect.
**Business Rule**: Discovered — `handleClearAll` try/finally
**Suggested Layer**: E2E (with route mock)

### TC-310: The bookings list shows an error state when the API fails
**Category**: Negative
**Priority**: P2
**Preconditions**: Mock `GET /api/bookings` → 500 or network abort
**Steps**:
1. Open `/bookings`
2. Click "Retry" after removing the mock
**Expected Results**: "Couldn't load bookings" — "Failed to connect to the server. Please try again." — with a Retry button; Retry reloads the list.
**Business Rule**: Discovered — bookings page error state
**Suggested Layer**: E2E (route mock)

### TC-311: Non-numeric booking id
**Category**: Negative
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. `GET /api/bookings/abc`; `DELETE /api/bookings/abc`; open `/bookings/abc`
**Expected Results**: Should be a 400 or 404. Suspected (F7): a Prisma error turns into a 500. The UI shows "Booking not found" either way.
**Business Rule**: Discovered — `Number(id)` with no validation
**Suggested Layer**: API

### TC-312: The booking form blocks submission when fields are invalid
**Category**: Negative
**Priority**: P1
**Preconditions**: On `/events/:id`
**Steps**:
1. Click "Confirm Booking" with empty fields
**Expected Results**: Errors appear inline and no `POST /api/bookings` request is sent.
**Business Rule**: Flow 3 step 4
**Suggested Layer**: E2E

### TC-313: Server rejection during booking shows an error toast
**Category**: Negative
**Priority**: P2
**Preconditions**: Mock `POST /api/bookings` → 400 "Only 0 seat(s) available..."
**Steps**:
1. Submit a valid form
**Expected Results**: An error toast shows the server message; no confirmation card.
**Business Rule**: Discovered — `onError` toast
**Suggested Layer**: E2E (route mock)

---

## Edge Cases

### TC-400: At exactly 9 bookings, the 10th triggers the prune; at 8, the 9th does not
**Category**: Edge Case
**Priority**: P0
**Preconditions**: Start with 0 bookings (clear all via API)
**Steps**:
1. Create 9 bookings; check the count and that none were pruned
2. Create the 10th
**Expected Results**: After step 1: 9 bookings, all present. After step 2: still 9, and the oldest (from a different event, if one exists) is gone.
**Business Rule**: §4 — max 9
**Suggested Layer**: API

### TC-401: Quantity bounds in the UI — 1 minimum, min(10, available) maximum
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Event with ≥10 seats; and an event with 3 personal seats left
**Steps**:
1. On the first event, try to go below 1 with "−", then click "+" up to the limit
2. Repeat on the 3-seat event
**Expected Results**: "−" is disabled at 1. "+" is disabled at 10 on the first event and at 3 on the second. `#ticket-count` never goes past those limits.
**Business Rule**: Quantity 1–10; `maxQty = min(10, availableSeats)`
**Suggested Layer**: E2E (Component)

### TC-402: Booking exactly the remaining seats sells the event out
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Self-created event with totalSeats 2
**Steps**:
1. Book quantity 2
2. Reload the event
**Expected Results**: Seats show "SOLD OUT"; the button reads "Sold Out". A further API booking → 400 "Only 0 seat(s) available".
**Business Rule**: §6
**Suggested Layer**: E2E + API

### TC-403: Refund boundary — quantity 2 is the first ineligible value
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Bookings with qty 1, 2 and 10
**Steps**:
1. Check refund on each
**Expected Results**: qty 1 → eligible; qty 2 → "Group bookings (2 tickets) are non-refundable"; qty 10 → "(10 tickets)".
**Business Rule**: §8
**Suggested Layer**: Component (+1 E2E)

### TC-404: Booking ref prefix for titles that start with a digit, lowercase letter or non-ASCII character
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Create events titled "5K Run", "yoga retreat", "Événement"
**Steps**:
1. Book each
**Expected Results**: Refs start with `5-`, `Y-`, `É-` (the first character, `toUpperCase()`'d), followed by 6 characters from [A-Z0-9].
**Business Rule**: §7
**Suggested Layer**: API (Unit for `randomRef`)

### TC-405: Booking refs are unique across many bookings
**Category**: Edge Case
**Priority**: P3
**Preconditions**: None
**Steps**:
1. Create and clear bookings in a loop (e.g. 50) on one event; collect the refs
**Expected Results**: No duplicates. The retry loop (10 tries) and timestamp fallback stay invisible to the user.
**Business Rule**: §7 — unique via collision retry
**Suggested Layer**: Unit (mock `findByRef` collisions)

### TC-406: Ref lookup is case-sensitive or not
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User owns ref `T-AB12CD`
**Steps**:
1. `GET /api/bookings/ref/t-ab12cd`
**Expected Results**: Record the behaviour. MySQL's default collation is case-insensitive, so it probably matches; decide whether that is intended.
**Business Rule**: Discovered — `findUnique({ bookingRef })`
**Suggested Layer**: API

### TC-407: Clear all with zero bookings
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User has no bookings
**Steps**:
1. `DELETE /api/bookings`; also click the button in the UI (it is shown even when empty)
**Expected Results**: 200 "0 booking(s) cleared"; the UI stays on the empty state with no error.
**Business Rule**: §4
**Suggested Layer**: API

### TC-408: Pagination query edge values
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User has 9 bookings
**Steps**:
1. `GET /api/bookings?page=2&limit=5`, `?limit=0`, `?page=0`, `?page=999`, `?limit=-1`, `?page=abc`
**Expected Results**: page 2/limit 5 → 4 items, totalPages 2. limit=0 or abc → falls back to 10. page=999 → empty `data`, correct `total`. Record what page=0 and limit=-1 do (negative skip/take in Prisma probably errors or reverses order).
**Business Rule**: Discovered — `Number(x) || default`
**Suggested Layer**: API

### TC-409: Email normalisation changes the stored address
**Category**: Edge Case
**Priority**: P3
**Preconditions**: None
**Steps**:
1. Book with `customerEmail: "Rahul.Shetty+test@Gmail.com"`
2. View the detail page
**Expected Results**: Record what is stored and shown. express-validator `normalizeEmail()` lowercases the address and, for Gmail, strips dots and `+tag`, so it probably becomes `rahulshetty@gmail.com`. Decide whether that is acceptable.
**Business Rule**: Discovered — bookingValidator `normalizeEmail()`
**Suggested Layer**: API

### TC-410: A failed booking at the cap must not prune the oldest booking (unknown event)
**Category**: Edge Case
**Priority**: P1
**Preconditions**: User has exactly 9 bookings
**Steps**:
1. `POST /api/bookings` with a non-existent `eventId`
2. `GET /api/bookings`
**Expected Results**: Step 1 → 404, and the user should still have 9 bookings. Suspected (F3): only 8 remain, because the oldest was deleted before the event check.
**Business Rule**: §4 FIFO only on overflow (a failed create is not an overflow)
**Suggested Layer**: API

### TC-411: A failed booking at the cap must not prune the oldest booking (insufficient seats)
**Category**: Edge Case
**Priority**: P1
**Preconditions**: User has 9 bookings; event with 1 personal seat left
**Steps**:
1. `POST /api/bookings` with quantity 2 for that event
**Expected Results**: 400 and still 9 bookings. Suspected (F3): 8 remain.
**Business Rule**: §4
**Suggested Layer**: API

### TC-412: Very long customer fields
**Category**: Edge Case
**Priority**: P3
**Preconditions**: None
**Steps**:
1. Book with a 300-character name and a 300-character (digits) phone
**Expected Results**: Should be a clean 400. Suspected (F8): 500 from the database column-length error.
**Business Rule**: Discovered — no max-length validation
**Suggested Layer**: API

### TC-413: Booking an event dated in the past
**Category**: Edge Case
**Priority**: P3
**Preconditions**: An event whose `eventDate` has passed (e.g. a seeded event after its date)
**Steps**:
1. `POST /api/bookings` for it
**Expected Results**: Record the behaviour. The service does not check `eventDate`, so the booking will probably succeed. Confirm the intended rule.
**Business Rule**: Data model — eventDate must be a future date (enforced only when creating events)
**Suggested Layer**: API

### TC-414: Two quick cancel clicks on the same booking
**Category**: Edge Case
**Priority**: P3
**Preconditions**: Booking dialog open
**Steps**:
1. Double-click "Yes, cancel it"
**Expected Results**: Only one DELETE succeeds (the button shows loading via `isPending`). Any second call returns 404 without breaking the UI.
**Business Rule**: Discovered — ConfirmDialog `isLoading`
**Suggested Layer**: E2E

---

## UI State

### TC-500: The bookings list shows a skeleton while loading
**Category**: UI State
**Priority**: P3
**Preconditions**: Delay `GET /api/bookings` (route mock)
**Steps**:
1. Open `/bookings`
**Expected Results**: Five pulsing skeleton cards; real cards replace them once the data arrives.
**Business Rule**: Discovered — `BookingCardSkeleton`
**Suggested Layer**: Component / E2E (mock)

### TC-501: Empty state when the user has no bookings
**Category**: UI State
**Priority**: P1
**Preconditions**: 0 bookings
**Steps**:
1. Open `/bookings`; click "Browse Events"
**Expected Results**: "No bookings yet" — "You haven't booked any events yet. Browse upcoming events and grab your tickets!" "Browse Events" goes to `/events`. No pagination.
**Business Rule**: Discovered — EmptyState
**Suggested Layer**: E2E

### TC-502: The detail page shows a spinner while loading
**Category**: UI State
**Priority**: P3
**Preconditions**: Delay `GET /api/bookings/:id`
**Steps**:
1. Open `/bookings/:id`
**Expected Results**: A large centred spinner, then the details.
**Business Rule**: Discovered
**Suggested Layer**: Component

### TC-503: The cancel dialog content matches the booking
**Category**: UI State
**Priority**: P2
**Preconditions**: Booking with ref R, quantity Q
**Steps**:
1. Click "Cancel Booking" on the card; then on the detail page
**Expected Results**: Title "Cancel this booking?". Card text: "This will cancel R and release Q seat(s) back to the event. This action cannot be undone." Detail text: "Cancelling R will release Q seat(s) back to the event. This cannot be undone." Confirm label "Yes, cancel it".
**Business Rule**: Discovered — ConfirmDialog copy
**Suggested Layer**: E2E

### TC-504: Dismissing the cancel dialog keeps the booking
**Category**: UI State
**Priority**: P1
**Preconditions**: Dialog open
**Steps**:
1. Close it (close button / Escape / backdrop)
**Expected Results**: The dialog closes; no DELETE request is sent; the booking is still listed.
**Business Rule**: Discovered — Modal close
**Suggested Layer**: E2E

### TC-505: Dismissing the native "Clear all" confirm keeps the bookings
**Category**: UI State
**Priority**: P1
**Preconditions**: ≥1 booking
**Steps**:
1. Click "Clear all bookings"; dismiss the browser dialog (`page.on('dialog', d => d.dismiss())`)
**Expected Results**: No `DELETE /api/bookings` request; the list is unchanged.
**Business Rule**: Discovered — `window.confirm`
**Suggested Layer**: E2E

### TC-506: "Clear all" button loading state
**Category**: UI State
**Priority**: P3
**Preconditions**: Delay `DELETE /api/bookings`
**Steps**:
1. Click and accept
**Expected Results**: The label changes to "Clearing…" and the button is disabled until the request finishes. The hint "Do this often for clean test data." is always visible.
**Business Rule**: Discovered
**Suggested Layer**: Component

### TC-507: The refund button is replaced by the spinner, then by the result
**Category**: UI State
**Priority**: P2
**Preconditions**: On a detail page
**Steps**:
1. Click `check-refund-btn`
**Expected Results**: The button goes away while `refund-spinner` is shown; only `refund-result` remains afterwards; the result stays until the page reloads (then the button is back).
**Business Rule**: §8
**Suggested Layer**: Component

### TC-508: Pluralisation of the ticket label
**Category**: UI State
**Priority**: P3
**Preconditions**: Bookings with qty 1 and qty 2
**Steps**:
1. View the cards and the booking form summary
**Expected Results**: "1 ticket" vs "2 tickets"; the form shows "× 1 ticket" vs "× 2 tickets".
**Business Rule**: Discovered
**Suggested Layer**: Component

### TC-509: The status badge and cancel button depend on status
**Category**: UI State
**Priority**: P3
**Preconditions**: Booking with status "confirmed" (the only status the API produces)
**Steps**:
1. View the card and the detail page
**Expected Results**: Green "confirmed" badge; "Cancel Booking" is visible. (With a non-confirmed status, faked by mocking the API: red badge, no cancel button.)
**Business Rule**: Booking.status always "confirmed"
**Suggested Layer**: Component

### TC-510: Pagination does not render within the 9-booking cap
**Category**: UI State
**Priority**: P3
**Preconditions**: User has 9 bookings (the page requests `limit=10`)
**Steps**:
1. Open `/bookings`
**Expected Results**: All 9 on one page; Pagination shows nothing or a single page (totalPages = 1). Pagination only appears with a mocked `total > 10`.
**Business Rule**: §4 — bookings page shows max 9
**Suggested Layer**: Component

### TC-511: Sandbox banner on the bookings page
**Category**: UI State
**Priority**: P2
**Preconditions**: User has ~8–9 bookings
**Steps**:
1. Open `/bookings`
**Expected Results**: Per §5, a heads-up banner about the 9-booking limit should appear. Suspected (F6): no banner exists in the bookings page code. Confirm with the product owner whether the rule or the code is out of date.
**Business Rule**: §5 Sandbox warning banners
**Suggested Layer**: E2E

### TC-512: The confirmation card after booking links onward
**Category**: UI State
**Priority**: P2
**Preconditions**: Just booked
**Steps**:
1. Check the confirmation card; click "View My Bookings"
**Expected Results**: Shows the booking ref (`.booking-ref`) and the ticket count; "View My Bookings" goes to `/bookings`.
**Business Rule**: Flow 3 steps 6–7
**Suggested Layer**: E2E
