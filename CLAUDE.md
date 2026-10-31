# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
EventHub is a full-stack event ticket booking platform built for QA training. Users browse events, book tickets, manage bookings and create their own events. Every user operates in an isolated sandbox (see "Per-user sandbox" below).

- **Frontend** (`frontend/`, port 3000): Next.js 14 App Router, React 18, TypeScript + some JSX, Tailwind, React Query v5, axios
- **Backend** (`backend/`, port 3001): Express, Prisma 5 (MySQL 8), JWT auth (bcryptjs), express-validator, Swagger
- **Tests** (`tests/`): Playwright E2E, Chromium only

## Commands
All run from the repo root:
```bash
npm run setup        # npm install in backend/ and frontend/
npm run db:push      # push Prisma schema to DB (non-interactive)
npm run migrate      # prisma migrate dev (interactive, creates migration files)
npm run seed         # insert the 10 static events
npm run dev          # backend (nodemon) + frontend (next dev) concurrently
npm run build        # next build (frontend only)
npm run lint         # next lint (frontend only — backend has no linter)
npm run test         # all Playwright tests
npm run test:ui      # Playwright UI mode
npm run test:report  # open last HTML report
npx playwright test tests/<file>.spec.js --reporter=line   # single file
npx playwright test -g "<test title>" --reporter=line      # single test by title
```
Swagger UI: http://localhost:3001/api/docs (generated from JSDoc in `backend/src/routes/*.js` and `app.js`).

Env: `backend/.env` needs `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `JWT_SECRET`, `SHOW_EXPLORE_LINKS` (see `backend/.env.example`); `frontend/.env.local` needs `NEXT_PUBLIC_API_URL` (e.g. `http://localhost:3001/api`).

**Playwright targets the deployed site, not localhost**: `playwright.config.ts` sets `baseURL: https://eventhub.rahulshettyacademy.com`. Change it (or override `baseURL`) to test local changes. Config: `fullyParallel: false`, `retries: 0`, 30s test / 5s expect timeouts.

CI (`.github/workflows/`): `ci.yml` on PRs runs backend `node` syntax checks, `prisma validate`/`format --check`/`generate`, a schema drift check against the production DB, frontend `tsc` type check and `next build`. `playwright.yml` runs the E2E suite; `deploy.yml` deploys. There are no unit tests.

## Architecture

### Backend layering
`routes → validators → controllers → services → repositories → Prisma`
- `app.js` wires middleware and mounts `/api/auth`, `/api/events`, `/api/bookings`, plus `/api/health` and `/api/config` (feature flags). `server.js` starts the HTTP server.
- `middleware/authMiddleware.js` verifies the `Bearer` JWT and sets `req.user`; the user id is passed down into every service/repository call.
- Business rules live in **services**; repositories are thin Prisma access. Services throw domain errors from `utils/errors.js` (`NotFoundError`, `ForbiddenError`, `InsufficientSeatsError`, `ValidationError`) which `middleware/errorHandler.js` maps to HTTP status codes. Error JSON shape: `{ success: false, error: "..." }`.

### Per-user sandbox (spans repositories + services)
- Events are either **static** (`isStatic: true`, seeded, shared by all users, immutable — update/delete throw `ForbiddenError`) or **dynamic** (owned by `userId`). Every event query uses the ownership filter `OR: [{ isStatic: true }, { userId }]`, so users never see each other's events.
- **Seat counts are computed per user**: `eventService.withPersonalSeats` returns `availableSeats = DB availableSeats − this user's booked quantity`. Creating a booking does not decrement the DB column, and cancelling just deletes the booking row — the count "restores" because it is recomputed. The one exception: when the FIFO prune removes a booking for the *same* event being booked, `bookingService` permanently decrements the DB seats so the visible count still drops.
- **FIFO caps**: max 6 dynamic events per user (`MAX_USER_DYNAMIC_EVENTS` in `eventService.js`) and max 9 bookings per user (`MAX_USER_BOOKINGS` in `bookingService.js`); creating past the cap deletes the oldest (bookings prefer pruning a different event first).
- Accessing another user's booking throws `ForbiddenError` (UI shows "Access Denied").
- Booking ref format: `<first letter of event title, uppercased>-<6 alphanumerics>` (README's `EVT-XXXXXX` is outdated).
- Refund eligibility (1 ticket = eligible, >1 = not) is computed client-side only.

### Frontend
- Auth: `lib/hooks/useAuth.tsx` stores the JWT in `localStorage` under `eventhub_token`; the axios client in `lib/api/client.js` attaches it to requests. `components/auth/AuthGuard.tsx` protects pages; `components/layout/AppShell.tsx` is the app frame.
- Data fetching via React Query hooks in `lib/hooks/` (`useEvents.ts`, `useBookings.ts`); providers in `lib/providers.jsx`.
- `lib/api/` contains two parallel API layers — JS (`client.js`, `eventsApi.js`, `bookingsApi.js`, `authApi.js`) and TS (`client.ts`, `events.ts`, `bookings.ts`, `index.ts`). Check which one the page you're editing imports before changing either.
- Key elements carry `data-testid` attributes for tests (list in README "Playwright Test Selectors" and `.claude/skills/eventhub-domain/ui-selectors.md`).

## Testing Conventions
- Test files go in `tests/` as `<feature-name>.spec.js` (JavaScript).
- Follow `.claude/skills/playwright-best-practices/SKILL.md`.
- Locator priority: `data-testid` > role > label/placeholder > ID > CSS class.
- No `page.waitForTimeout()` — use web-first assertions like `expect(...).toBeVisible()`.
- Tests must be self-contained (login → action → assert) and add step comments.
- Test account: `rahulshetty1@gmail.com` / `Magiclife1!`. Because of the FIFO caps, tests must not assume a fixed number of pre-existing user events/bookings.

## Project Skills (`.claude/skills/`)
- `generate-tests` — generate Playwright tests for a feature
- `review-tests` — review test code quality
- `create-scenarios` — write test scenario documents (output: `docs/test-scenarios.md`)
- `test-strategy` — assign scenarios to test pyramid layers (output: `docs/test-strategy.md`)
- `eventhub-domain` — business rules, API reference, user flows, UI selectors
- `playwright-best-practices` — Playwright standards

## Code Style
- Backend: CommonJS JavaScript with JSDoc; Swagger docs as JSDoc on routes.
- Frontend: TypeScript for new code, React hooks, Tailwind utility classes.
