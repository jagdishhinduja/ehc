---
name: eventhub-domain
description: EventHub application domain knowledge — business rules, API endpoints, data models, user flows, UI selectors, and error scenarios. Use when writing tests, reviewing code, creating scenarios, or answering questions about how EventHub works.
user-invocable: false
---

# EventHub Domain Knowledge

## Overview
EventHub is a full-stack event ticket booking platform. Users browse events, book tickets, and manage bookings. Each user operates in an isolated sandbox with limits on events and bookings.

## Tech Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, React Query v5
- **Backend**: Express.js 4.21, Prisma ORM 5.22, MySQL 8+
- **Auth**: JWT (7-day expiry), bcryptjs password hashing
- **Testing**: Playwright (E2E), Chromium only
- **API Docs**: Swagger UI at `/api/docs`

## Architecture
```
frontend/ (Next.js 14)           backend/ (Express.js)
├── app/                         ├── src/
│   ├── page.tsx (Home)          │   ├── routes/       (HTTP layer)
│   ├── login/                   │   ├── controllers/  (Request handling)
│   ├── register/                │   ├── services/     (Business logic)
│   ├── events/                  │   ├── repositories/ (Data access)
│   │   ├── page.tsx (List)      │   ├── validators/   (Input validation)
│   │   └── [id]/page.tsx        │   ├── middleware/    (Auth, errors)
│   ├── bookings/                │   └── utils/        (Error classes)
│   │   ├── page.tsx (List)      ├── prisma/
│   │   └── [id]/page.tsx        │   ├── schema.prisma
│   └── admin/                   │   └── seed.js
│       ├── events/page.tsx      └── app.js
│       └── bookings/page.tsx
├── components/
├── lib/
│   ├── api/ (client, endpoints)
│   └── hooks/ (useAuth, useEvents, useBookings)
└── types/
```

## Data Models

### User
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | Auto-increment |
| email | String | Unique |
| password | String | bcrypt hashed |
| events | Event[] | User's created events |
| bookings | Booking[] | User's bookings |

### Event
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | Auto-increment |
| title | String | Required |
| description | Text | Optional |
| category | String | Conference/Concert/Sports/Workshop/Festival |
| venue | String | Required |
| city | String | Bangalore/Mumbai/Hyderabad/Delhi/Chennai |
| eventDate | DateTime | Must be future date |
| price | Decimal | Per ticket, >= 0 |
| totalSeats | Int | >= 1 |
| availableSeats | Int | Dynamic for user events |
| isStatic | Boolean | true = seeded event, immutable |
| userId | Int? | null for static events |

### Booking
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | Auto-increment |
| eventId | Int (FK) | Cascade delete with Event |
| userId | Int (FK) | Cascade delete with User |
| customerName | String | Min 2 chars |
| customerEmail | String | Valid email format |
| customerPhone | String | Min 10 digits |
| quantity | Int | 1-10 tickets |
| totalPrice | Decimal | price x quantity |
| status | String | Always "confirmed" |
| bookingRef | String | Unique, format: `[FIRST_LETTER]-[6_RANDOM]` |

## Detailed Knowledge (Sub-Files)

Load these based on what the current task needs:

- **Business rules & validation logic** → read `./business-rules.md`
- **API endpoints & error codes** → read `./api-reference.md`
- **UI selectors for test automation** → read `./ui-selectors.md`
- **User flows, test scenarios & test data** → read `./user-flows.md`



---
# EventHub Business Rules

## 1. User Journey
- User signs up or signs in -> browses events -> selects an event -> books tickets
- On booking: seat count reduces immediately, booking reference is generated
- Booking reference first character MUST match the event title's first character (e.g., Event "Tech Summit" -> Ref starts with "T")
- After booking, user can view bookings via "View My Bookings" link or "View Details"
- User can cancel (delete) individual bookings or "Clear All Bookings" in one action
- Users can also create events from the Admin UI or via API

## 2. User Sandbox Isolation
- Each user only sees their own dynamic events and bookings
- Static events (seeded) are shared across all users
- Cross-user access to bookings returns 403 Forbidden ("Access Denied")
- Deleting a user cascades to their events and bookings

## 3. Event Limits (FIFO Pruning)
- Max **6 user-created events** per account
- When limit reached, the OLDEST event is automatically deleted (FIFO replacement)
- Static events are not counted toward this limit
- Static events cannot be edited or deleted
- Events page shows max 9 events at a time with pagination

## 4. Booking Limits (FIFO Pruning)
- Max **9 bookings** per user
- When limit reached, the OLDEST booking is automatically deleted (FIFO replacement)
- Bookings page shows max 9 bookings at a time
- Booking deletion (cancellation) immediately frees seats
- "Clear All Bookings" button removes all bookings in one go

## 5. Sandbox Warning Banners
- **Events page**: Banner appears when user has close to or more than 6 events displayed, warning about sandbox limits ("sandbox holds up to 6 events and 9 bookings")
- **Bookings page**: Conditional banner also appears giving heads-up about booking limits
- Banners are hidden when counts are low (e.g., fewer than 5 events)

## 6. Per-User Seat Availability
- For static events: `availableSeats` is a fixed DB field
- For dynamic (user-created) events: computed as `totalSeats - sum(user's booking quantities for that event)`
- This allows the same user to book the same event multiple times for testing
- Seat count reduces immediately on booking confirmation

## 7. Booking Reference Format
- Pattern: `[FIRST_LETTER]-[6_RANDOM_ALPHANUMERIC]`
- **First letter comes from the event title (uppercase)** - this is a key business rule to validate
- Example: Event "Tech Summit" -> Ref: `T-A3B2C1`
- Guaranteed unique via collision retry

## 8. Refund Eligibility (Client-Side Logic)
- **Single ticket bookings (quantity = 1) -> Eligible for refund** with message "Single-ticket bookings qualify for a full refund"
- **Multi-ticket bookings (quantity > 1) -> NOT eligible for refund** with message "Group bookings (N tickets) are non-refundable"
- Displays a **4-second spinner** animation before revealing the result
- This is frontend-only logic (no backend API for refund)
- Accessible via "Check Refund Eligibility" button on booking detail page

## 9. Price Calculation
- `totalPrice = event.price x quantity`
- Price is per-ticket in the Event model




----

# EventHub User Flows & Test Data

## Flow 1: Registration & Login
1. Navigate to /register
2. Enter email (must be unique) and password (min 6 chars)
3. Submit -> JWT issued -> redirected to home
4. Or: Navigate to /login -> enter credentials -> JWT issued -> home

## Flow 2: Browse & Filter Events
1. Login -> navigate to /events
2. Use search bar (searches title, description, venue)
3. Filter by category dropdown (Conference, Concert, etc.)
4. Filter by city dropdown (Bangalore, Mumbai, etc.)
5. Paginate (12 events per page)
6. Click "Book Now" on any event card

## Flow 3: Book an Event
1. From event card -> click "Book Now" -> navigate to /events/:id
2. See event details (title, date, venue, price, available seats)
3. Select quantity (1-10) using +/- buttons
4. Fill customer form: name, email, phone
5. Click "Confirm Booking"
6. See confirmation card with booking reference
7. Navigate to "View My Bookings" or "Browse Events"

## Flow 4: Manage Bookings
1. Navigate to /bookings
2. See list of all bookings with details
3. Click "View Details" -> /bookings/:id
4. See full booking info + event details
5. Check refund eligibility (spinner + result)
6. Cancel booking (delete)
7. Or: "Clear all bookings" from bookings list

## Flow 5: Admin - Manage Events
1. Navigate to /admin/events
2. Fill event creation form (title, category, city, venue, date, price, seats)
3. Submit -> "Event created!" toast
4. See list of user-created events
5. Edit existing events (update form)
6. Delete events (with cascade to bookings)

## Flow 6: Cross-User Security
1. User A creates a booking
2. User A captures booking ID
3. Switch to User B (clear localStorage, re-login)
4. User B navigates to /bookings/:userA_booking_id
5. Sees "Access Denied" message

---

## Test Data

### Seeded Data (10 Static Events)
Run `npm run seed` to insert:
- Tech Conference Bangalore (Conference, 500 seats, $1499)
- Bollywood Night Mumbai (Concert, 1000 seats, $999)
- IPL Cricket Finals (Sports, 40000 seats, $2499)
- Digital Marketing Workshop (Workshop, 100 seats, $299)
- Holi Festival Delhi (Festival, 5000 seats, $199)
- AI Summit Hyderabad (Conference, 300 seats, $1999)
- Classical Music Evening (Concert, 200 seats, $799)
- Marathon Chennai (Sports, 10000 seats, $49)
- Photography Workshop (Workshop, 50 seats, $399)
- Food Festival Bangalore (Festival, 2000 seats, $149)

### Test Accounts
| Account    | Email                    | Password    |
|------------|--------------------------|-------------|
| Gmail User | rahulshetty1@gmail.com   | Magiclife1! |
| Yahoo User | rahulshetty1@yahoo.com   | Magiclife1! |

--
# EventHub API Reference

## Authentication (No Auth Required)
| Method | Endpoint          | Body                    | Response                          |
|--------|-------------------|-------------------------|-----------------------------------|
| POST   | /api/auth/register| { email, password }     | { token, user: { id, email } }    |
| POST   | /api/auth/login   | { email, password }     | { token, user: { id, email } }    |
| GET    | /api/auth/me      | -                       | { user: { userId, email } }       |

## Events (Bearer Token Required)
| Method | Endpoint        | Query/Body                         | Response                     |
|--------|-----------------|------------------------------------|------------------------------|
| GET    | /api/events     | ?search, category, city, page, limit | { data: Event[], pagination }|
| GET    | /api/events/:id | -                                  | { data: Event }              |
| POST   | /api/events     | CreateEventInput                   | { data: Event }              |
| PUT    | /api/events/:id | UpdateEventInput                   | { data: Event }              |
| DELETE | /api/events/:id | -                                  | { message }                  |

## Bookings (Bearer Token Required)
| Method | Endpoint              | Query/Body                    | Response                      |
|--------|-----------------------|-------------------------------|-------------------------------|
| GET    | /api/bookings         | ?eventId, status, page, limit | { data: Booking[], pagination}|
| GET    | /api/bookings/:id     | -                             | { data: Booking }             |
| GET    | /api/bookings/ref/:ref| -                             | { data: Booking }             |
| POST   | /api/bookings         | CreateBookingInput            | { data: Booking }             |
| DELETE | /api/bookings         | -                             | Clear all user bookings       |
| DELETE | /api/bookings/:id     | -                             | Cancel single booking         |

## Error Scenarios
| Scenario                  | HTTP Code | Message                              |
|---------------------------|-----------|--------------------------------------|
| Invalid login credentials | 401       | Invalid credentials                  |
| Duplicate email register  | 409       | Email already registered             |
| Missing auth token        | 401       | Unauthorized                         |
| Cross-user booking access | 403       | Forbidden / Access Denied            |
| Edit static event         | 403       | Cannot modify static events          |
| Insufficient seats        | 400       | Insufficient seats available         |
| Invalid event date (past) | 400       | Event date must be in the future     |
| Missing required fields   | 400       | Validation error details             |
