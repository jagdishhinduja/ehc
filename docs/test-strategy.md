# EventHub — Booking Management Test Strategy

Generated: 2026-10-30
Input: `docs/test-scenarios.md` (64 booking scenarios, TC-001 – TC-512, findings F1–F8)
Consumer: `/generate-tests`

Sources scanned: `backend/src/services/bookingService.js`, `backend/src/services/eventService.js`, `backend/src/controllers/bookingController.js`, `backend/src/validators/bookingValidator.js`, `backend/src/repositories/bookingRepository.js`, `backend/src/middleware/{authMiddleware,errorHandler}.js`, `frontend/app/bookings/page.tsx`, `frontend/app/bookings/[id]/page.tsx`, `frontend/app/events/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/lib/api/{client.js,client.ts,bookings.ts,bookingsApi.js}`, `frontend/lib/hooks/useBookings.ts`, `tests/booking-management.spec.js`.

---

## 1. Distribution

| Layer | Tests | Scenario IDs covered | Focus | Est. run time |
|---|---|---|---|---|
| **Unit** | 15 test groups | 19 | Ref generation, FIFO prune selection and ordering, validator boundaries, seat/price/refund formulas | < 2 s |
| **API** | 38 | 38 | HTTP contract, status codes, sandbox isolation, FIFO and seat rules against a real DB | ~20–30 s |
| **Component** | 26 | 28 | Booking list/detail/form rendering, loading/empty/error states, dialogs, refund timer | ~10 s |
| **E2E** | 7 | 13 (consolidated) | Critical user journeys and the defects that only show up in the browser (F1) | ~2 min |

There are 86 tests in total for 64 scenarios (times are estimates). Critical rules are deliberately covered at more than one layer (section 4).

**Shape:** the current suite is 6 E2E tests and nothing else (an ice-cream cone). The target shape is a pyramid with a thick API middle. Most business logic sits in services that call Prisma directly, with few pure functions. That makes API the natural workhorse until the extractions in section 5 widen the unit base.

---

## 2. Layer Assignments

Legend: ★ = primary layer; + = additional layer for defence-in-depth; ⚠ = expected to fail until defect Fn is fixed (mark with `test.fail()` and the Fn reference, so the test flips to red when the bug is fixed and the annotation gets removed).

### 2.1 Unit (backend: Jest + `jest.mock` of repositories; frontend pure helpers: Vitest)

| ID | Scenario | Target | Notes |
|---|---|---|---|
| TC-102 + | Ref prefix = first char of title, uppercase | `randomRef()` in `bookingService.js` | Needs to be exported (§5) |
| TC-404 ★ | Prefix for digit / lowercase / non-ASCII titles | `randomRef()` | Table-driven: `"5K Run"`, `"yoga"`, `"Événement"`, `""` / `undefined` → `E-` |
| TC-405 ★ | Ref uniqueness via retry and fallback | `generateUniqueRef()` with mocked `bookingRepository.findByRef` | Mock 3 collisions then a miss; and 10 collisions → timestamp fallback `^X-[A-Z0-9]{1,8}$` |
| TC-100 + | FIFO prefers the oldest booking from a different event | `bookingService.createBooking` | Mock `countUserBookings → 9`; assert `findOldestUserBookingExcludingEvent` is called first and `delete(oldest.id)` |
| TC-101 + | Same-event fallback burns seats | `bookingService.createBooking` | Excluding-event returns null → assert `eventRepository.decrementSeats(eventId, qty)` is called |
| TC-400 + | Count 8 → no prune; count 9 → prune | `bookingService.createBooking` | Boundary on `MAX_USER_BOOKINGS` |
| TC-410 + ⚠F3 | Unknown event at the cap must not prune | `bookingService.createBooking` | `eventRepository.findById → null`; assert `bookingRepository.delete` **not** called |
| TC-411 + ⚠F3 | Insufficient seats at the cap must not prune | `bookingService.createBooking` | Same as above, with the seat check failing |
| TC-305 + | Missing fields → one error per field | `validateCreateBooking` chains run against a mock `req` | `await Promise.all(chain.map(v => v.run(req)))` then `validationResult(req)` |
| TC-306 + | Quantity boundaries | `validateCreateBooking` | 0, 1, 10, 11, -1, 2.5, "abc", "5" |
| TC-307 + | Name / email / phone / eventId rules | `validateCreateBooking` | Includes the phone regex `^[0-9+\-\s()]+$` and length ≥ 10 |
| TC-409 ★ | Email normalisation | `validateCreateBooking` | Assert `req.body.customerEmail` after the chain runs |
| TC-106 + | totalPrice = price × qty | `calcTotalPrice()` (extract, §5) | Includes Decimal-as-string input `"1499.00"` |
| TC-107 + / TC-108 + / TC-402 + | Personal seats = DB seats − user's booked quantity, floored at 0 | `withPersonalSeats` math (extract, §5) | |
| TC-103 + / TC-104 + / TC-403 + | Refund eligible ⇔ quantity === 1 | `isRefundEligible()` (extract from `RefundEligibility`, §5) | Table: 1 → true; 2, 10 → false |

### 2.2 API (Playwright `request` fixture, new `api` project)

| ID | Endpoint | Assertion focus |
|---|---|---|
| TC-008 ★ | `GET /api/bookings/ref/:ref` | 200, `data.bookingRef`, `data.event` included |
| TC-009 ★ | `GET /api/bookings?page&limit` | Pagination object; only the caller's bookings |
| TC-100 ★ | `POST /api/bookings` ×10 | 9 remain; oldest (other event) gone; newest first |
| TC-101 ★ | `POST /api/bookings` on the same event at the cap | Count stays 9; DB `availableSeats` drops by Q |
| TC-102 ★ | `POST /api/bookings` | `bookingRef` matches `^<T>-[A-Z0-9]{6}$` for a known title |
| TC-106 ★ | `POST /api/bookings` | `Number(totalPrice) === price × qty` |
| TC-107 ★ | `POST` then `GET /api/events/:id` | `availableSeats` drops by Q |
| TC-108 ★ | `DELETE /api/bookings/:id` then `GET /api/events/:id` | Restored for a static and a dynamic event |
| TC-110 ★ | `GET /api/bookings` as A and as B | No overlap |
| TC-111 ★ | `POST` ×2 on the same event | Two refs; seats −(q1+q2) |
| TC-112 ★ | `DELETE /api/events/:id` | Booking → 404 afterwards |
| TC-113 ★ | `POST /api/events` ×7 | Bookings of the pruned event are gone |
| TC-201 ★ | `GET /api/bookings/:id` as B | 403 + message; no `data` |
| TC-202 ★ ⚠F2 | `DELETE /api/bookings/:id` as B | Booking survives. Status: expect 403 per the rule (code returns 404) |
| TC-203 ★ | `GET /api/bookings/ref/:ref` as B | 403 |
| TC-204 ★ | `DELETE /api/bookings` as A | B unaffected |
| TC-205 ★ | All 6 booking routes | 401 matrix: none / wrong scheme / tampered / expired JWT |
| TC-206 ★ ⚠F4 | Same-event fallback by A on a static event | B's `availableSeats` unchanged |
| TC-207 ★ | `POST /api/bookings` with B's eventId | 404; no booking created |
| TC-209 ★ | `POST` with extra `userId`, `totalPrice`, `bookingRef`, `status` | All ignored |
| TC-301 ★ | `GET`/`DELETE /api/bookings/99999999` | 404 |
| TC-302 ★ | `GET /api/bookings/ref/Q-ZZZZZZ` | 404 |
| TC-303 ★ | `POST` quantity > personal seats | 400 "Only S seat(s) available…" |
| TC-304 ★ | `POST` unknown eventId | 404 |
| TC-305 ★ | `POST {}` | 400, `details[]` has 5 fields (one contract case; boundaries at Unit) |
| TC-306 ★ | `POST` quantity 0 and 11 | 400 (two representative cases only) |
| TC-307 ★ | `POST` with a bad email | 400 + `details[].field === 'customerEmail'` |
| TC-308 ★ | `DELETE` twice | Second call → 404 |
| TC-311 ★ ⚠F7 | `GET`/`DELETE /api/bookings/abc` | Not 500 |
| TC-400 ★ | 9 then 10 bookings | Boundary against a real DB |
| TC-402 ★ | Book all remaining seats, then one more | 400 "Only 0 seat(s)…" |
| TC-406 ★ | Lowercase ref lookup | Record behaviour (collation) |
| TC-407 ★ | `DELETE /api/bookings` when empty | 200 "0 booking(s) cleared" |
| TC-408 ★ | `page`/`limit` edge values | Defaults; no 500 on 0 / -1 / abc |
| TC-410 ★ ⚠F3 | Unknown event at the cap | Still 9 bookings |
| TC-411 ★ ⚠F3 | Insufficient seats at the cap | Still 9 bookings |
| TC-412 ★ ⚠F8 | 300-character name / phone | 400, not 500 |
| TC-413 ★ | Booking a past-dated event | Record behaviour |

### 2.3 Component (frontend: Vitest + React Testing Library; mock `@/lib/hooks/useBookings`, `@/lib/api/*`, `next/navigation`)

| ID | Component | Assertion focus |
|---|---|---|
| TC-007 ★ | `BookingDetailPage` | Breadcrumb and "Back" link `href="/bookings"` |
| TC-103 ★ / TC-104 ★ / TC-403 ★ | `RefundEligibility` | Exact copy per quantity; green/red variant |
| TC-105 ★ | `RefundEligibility` | Fake timers: nothing at 3999 ms, result at 4000 ms |
| TC-106 + | Booking form (`events/[id]`) | Running total `price × qty`; USD, 0 decimals |
| TC-210 ★ | `BookingCard`, `BookingDetailPage` | Script-like name rendered as literal text |
| TC-300 ★ | `BookingDetailPage` | Error with status 404 → "Booking not found" copy + button |
| TC-200 + | `BookingDetailPage` | Error with status 403 → "Access Denied" copy |
| TC-309 ★ | `BookingsPage` | `clearAll` rejects → an error message must be shown (currently none) |
| TC-310 ★ | `BookingsPage` | `isError` → "Couldn't load bookings" + Retry calls `refetch` |
| TC-312 ★ | Booking form | Empty submit → inline errors; `createBooking` not called |
| TC-313 ★ | Booking form | Mutation `onError` → toast with the server message |
| TC-401 ★ | Booking form | −/+ disabled at 1 and at `min(10, availableSeats)` |
| TC-402 + | Booking form / event detail | `availableSeats: 0` → "SOLD OUT" and a "Sold Out" button |
| TC-414 ★ | `ConfirmDialog` via `BookingCard` | `isPending` → confirm button disabled; one `mutate` call |
| TC-500 ★ | `BookingsPage` | `isLoading` → 5 `BookingCardSkeleton` |
| TC-501 ★ | `BookingsPage` | Empty → "No bookings yet"; "Browse Events" `href="/events"` |
| TC-502 ★ | `BookingDetailPage` | `isLoading` → spinner |
| TC-503 ★ | `BookingCard`, `BookingDetailPage` | Dialog copy contains the ref and Q |
| TC-504 ★ | `BookingCard` | Close / Escape → no `mutate` |
| TC-505 ★ | `BookingsPage` | `window.confirm → false` → `clearAll` not called |
| TC-506 ★ | `BookingsPage` | Pending `clearAll` → "Clearing…" and disabled |
| TC-507 ★ | `RefundEligibility` | Button → spinner → result transitions |
| TC-508 ★ | `BookingCard`, booking form | "1 ticket" / "2 tickets" |
| TC-509 ★ | `BookingCard`, `BookingDetailPage` | Non-"confirmed" status → danger badge, no cancel button |
| TC-510 ★ | `BookingsPage` | `totalPages: 1` vs mocked `> 1` |
| TC-511 ★ ⚠F6 | `BookingsPage` | 9 bookings → limit banner (rule says yes; code has none) |

### 2.4 E2E (Playwright, Chromium) — 7 tests

| Test | Scenarios folded in | Journey |
|---|---|---|
| E2E-1 Book and find it in My Bookings | TC-002 ★, TC-512 ★, TC-001 ★, TC-102 +, TC-107 + | Event detail → book → confirmation card (ref matches title) → "View My Bookings" → card visible with ref; event seats decreased |
| E2E-2 Booking detail and refund check | TC-003 ★, TC-103 + | Seed one qty-1 booking via API → list → View Details → all sections → refund "Eligible" (expect timeout ≥ 6 s) |
| E2E-3 Cancel from list card | TC-004 ★ | Seed via API → cancel → toast → card gone |
| E2E-4 Cancel from detail page | TC-005 ★ | Seed via API → detail → cancel → redirect + toast |
| E2E-5 Clear all bookings ⚠F1 | TC-006 ★, TC-109 ★ | Seed 2 via API → clear all (accept dialog) → reload → empty; assert the request carried `Authorization` |
| E2E-6 Cross-user Access Denied | TC-200 ★ | A seeds a booking via API → B opens `/bookings/:id` → "Access Denied" |
| E2E-7 Logged-out redirect | TC-208 ★ | Empty storage → `/bookings` and `/bookings/1` → `/login` |

---

## 3. Decision Rationale (contested assignments)

| ID | Decision | Why |
|---|---|---|
| TC-109 / TC-006 | **E2E is the primary layer**, not API | F1 is a frontend wiring bug: `bookings/page.tsx` imports `bookingsApi` from `lib/api/bookings.ts`, which uses `client.ts` (`fetch`, no token). The rest of the app uses `client.js` (axios + JWT interceptor). An API test of `DELETE /api/bookings` passes no matter what. A component test that mocks `bookingsApi.clearAll` hides it too. Only a real browser request shows the missing header. |
| TC-102 | Unit + API + E2E | The domain doc calls it a key rule. Unit covers every character class cheaply. API proves it with real titles. One E2E assertion proves the UI shows the same ref. The E2E assertion rides along in E2E-1 at no extra cost. |
| TC-103 / TC-104 | Component ★, one E2E | The rule is pure client logic (`quantity === 1` in `RefundEligibility`), so E2E would be "pure logic at E2E". One E2E (qty 1) stays because it's the only check that the detail page actually wires `booking.quantity` into the component. The 4-second wait makes extra E2E cases expensive. |
| TC-105 | Component with fake timers, not E2E | Timing assertions in a real browser are flaky. `vi.useFakeTimers()` gives exact 3999/4000 ms boundaries. |
| TC-100 / TC-101 / TC-400 / TC-410 / TC-411 | Unit + API | Unit with mocked repositories proves the **order of operations** (prune before or after validation — the heart of F3) and which repo method is chosen. API proves the real Prisma queries (`createdAt asc`, `eventId: { not }`) behave the same. E2E is rejected: building 9 bookings through the UI costs ~2 min per test. |
| TC-200 | E2E ★, Component + | Flow 6 is a documented multi-user journey, and the 403 → "Access Denied" path crosses the axios interceptor (`enhanced.status`), React Query and the page. The component test covers the copy; the E2E test covers the wiring. The 403 contract itself lives at API (TC-201). |
| TC-202 | API only, flagged ⚠ | The pass condition is "the booking survives". The status code (404 vs the documented 403) is a product decision. Write the test to expect 403 with `test.fail()` until it's decided. |
| TC-206 | API only | Needs two users and DB-level seat values. There's nothing to see in the UI that API can't check more precisely. |
| TC-208 | E2E, not Component | The redirect involves `AuthGuard`, the Next router and the axios 401 handler (`window.location.href = '/login'`). It's cheap at E2E (no data setup). |
| TC-300 | Component, not E2E | It's only a rendering branch of `BookingDetailPage` (`isError && status !== 403`). The 404 contract is already at API (TC-301). |
| TC-305–307 | Unit (boundaries) + API (one case each) | Avoids the "input validation at E2E" anti-pattern and keeps API from becoming a 30-case validation matrix. API keeps one case per field to lock the `{ error, details[] }` contract. |
| TC-312 | Component | Client-side `validate()` in the booking form. It needs no server. |
| TC-001 / TC-512 / TC-107 | Folded into E2E-1 | Each would be a separate E2E with identical setup. Folding gives the same coverage for one booking. |
| TC-510 / TC-511 | Component | With the 9-booking cap and `limit=10`, real data can never exceed one page, so pagination can only be tested with mocked data. |

---

## 4. Defence-in-Depth (critical rules at more than one layer)

| Rule | Unit | API | Component | E2E |
|---|---|---|---|---|
| Booking ref = title's first char | TC-102, TC-404, TC-405 | TC-102 | — | E2E-1 |
| FIFO max 9 bookings | TC-100, TC-101, TC-400, TC-410, TC-411 | TC-100, TC-101, TC-400, TC-410, TC-411 | — | — (too costly; covered below) |
| Seats reduce on booking / restore on cancel | seat math | TC-107, TC-108, TC-402 | TC-402 | E2E-1 |
| Cross-user access denied | — | TC-201–TC-204, TC-207 | TC-200 | E2E-6 |
| Refund eligibility | `isRefundEligible` | — (client-only) | TC-103, TC-104, TC-403 | E2E-2 |
| Price = price × qty | `calcTotalPrice` | TC-106 | TC-106 | — |
| Clear all | — | TC-204, TC-407 | TC-309, TC-505, TC-506 | E2E-5 |

---

## 5. Prerequisites (tooling and small refactors)

| # | Needed for | Change |
|---|---|---|
| P1 | API layer | Add an `api` project to `playwright.config.ts` (`testDir: './tests/api'`, `use.baseURL` from `process.env.API_URL`, default `http://localhost:3001/api`). Auth helper: `POST /auth/login` → `Authorization: Bearer`. Cross-user tests use both test accounts in `user-flows.md` (gmail + yahoo). |
| P2 | All layers that touch shared state | `beforeEach`: `DELETE /api/bookings` via API, for each account used. Shared accounts force serial runs, so set `workers: 1` (today `fullyParallel: false` only serialises within a file). FIFO tests (TC-100, TC-101, TC-400, TC-410, TC-411, TC-113) should register a throwaway user per test, **locally only**. |
| P3 | Unit (backend) | Add Jest to `backend/` (`jest.mock('../repositories/bookingRepository')`, `jest.mock('../config/database')`). Export `randomRef` and `generateUniqueRef` from `bookingService.js` (currently module-private). Extract `calcTotalPrice(price, qty)` and the `withPersonalSeats` arithmetic into pure functions. |
| P4 | Component | Add Vitest + `@testing-library/react` + jsdom to `frontend/`. Move `RefundEligibility` out of `app/bookings/[id]/page.tsx` and the booking form out of `app/events/[id]/page.tsx` into `components/`, so they can be imported. Extract `isRefundEligible(quantity)`. |
| P5 | E2E data setup | Seed bookings through the API (`request.post('/bookings')`) and inject the token into `localStorage['eventhub_token']` with `page.addInitScript`, instead of logging in and booking through the UI in every test. |
| P6 | Stable E2E locators | Add `data-testid` to the confirm-booking button (today `id="confirm-booking"` + class `confirm-booking-btn`), the booking-ref spans (class `booking-ref`), the refund section and the detail header ref. The README's `data-testid` table lists several that don't exist in the code (`confirm-booking-btn`, `booking-ref`, `customer-name`, `customer-phone`, `confirm-dialog-yes`). |

---

## 6. Anti-Patterns in Existing Tests (`tests/booking-management.spec.js`)

| # | Anti-pattern | Where | Fix |
|---|---|---|---|
| A1 | **Ice-cream cone**: 100% of the suite is E2E; no API, component or unit tests | Whole repo | Section 1 distribution |
| A2 | Hard-coded `BASE_URL` constant duplicates `playwright.config.ts` `baseURL`; absolute `toHaveURL(`${BASE_URL}/bookings`)` | Top of file, TC-003, TC-006 | Use relative `page.goto('/bookings')` and `toHaveURL(/\/bookings$/)` so the suite can target localhost |
| A3 | UI-driven setup in every test (form login + `clearBookings` + `bookEvent`), roughly 70% of runtime | All 6 tests | P5: API seeding + token injection |
| A4 | Setup depends on the suspected-broken clear-all path (F1). If F1 is real against the target build, every test's setup breaks, not just the clear-all test | `clearBookings()` | Clear via `request.delete('/api/bookings')` |
| A5 | Non-retrying state check `isVisible().catch(() => false)` runs while the list may still show skeletons, so it can make the wrong choice | `clearBookings()` | API cleanup removes the need for it |
| A6 | Styling-class locators: `span.font-mono.font-bold`, `.confirm-booking-btn`, `.booking-ref`. The "breadcrumb" assertion in TC-002 actually targets the header chip, not the breadcrumb | TC-002, `bookEvent()` | P6 test ids; `getByRole('navigation')` for the breadcrumb |
| A7 | Pure logic tested only at E2E (ref prefix rule) | TC-102 | Keep as one assertion inside E2E-1; add Unit + API |
| A8 | Copy-pasted booking flow instead of the existing helper | TC-006 re-implements `bookEvent()` | Reuse the helper / API seed |
| A9 | Scenario IDs out of date: spec IDs follow the March numbering (spec TC-002 = now TC-003, TC-003 = TC-005, TC-004 = TC-006, TC-006 = TC-002) | Test titles | Rename to the IDs in section 2.4 |
| A10 | `console.log` noise in helpers and tests | `bookEvent()`, TC-006, TC-102 | Remove, or use `test.info().annotations` |
| A11 | All tests share one live account with mutable state; adding a second spec file will run it in a parallel worker and collide | Config + account | P2 (`workers: 1`, per-test cleanup) |

---

## 7. Suggested File Layout for `/generate-tests`

```
tests/
├── booking-management.spec.js        # E2E-1 … E2E-7 (rewrite of the existing file)
├── api/
│   ├── helpers/auth.js               # login(request, account) → token; clearBookings(request, token)
│   ├── bookings.contract.api.spec.js # TC-008, 009, 301–308, 311, 406–408, 412, 413
│   ├── bookings.rules.api.spec.js    # TC-100–102, 106–108, 110–113, 400, 402, 410, 411
│   └── bookings.security.api.spec.js # TC-201–207, 209
backend/src/services/__tests__/bookingService.test.js      # Unit (Jest)
backend/src/validators/__tests__/bookingValidator.test.js  # Unit (Jest)
frontend/components/bookings/__tests__/*.test.tsx          # Component (Vitest + RTL)
```

Generate in this order: API (no refactor needed, highest value) → E2E rewrite → Unit (after P3) → Component (after P4).
