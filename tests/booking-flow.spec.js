import { test, expect } from '@playwright/test';

// E2E-1 … E2E-3 from docs/test-strategy.md §2.4.
// Setup (login, cleanup, seeding) goes through the API; only the journey under test uses the UI.

const API_URL       = process.env.API_URL ?? 'https://api.eventhub.rahulshettyacademy.com/api';
const USER_EMAIL    = 'rahulshetty1@gmail.com';
const USER_PASSWORD = 'Magiclife1!';

const formatPrice = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    .format(Number(amount));

// ── API helpers ────────────────────────────────────────────────────────────────

/** Logs in via the API and returns the JWT. */
async function apiLogin(request) {
  const res = await request.post(`${API_URL}/auth/login`, {
    data: { email: USER_EMAIL, password: USER_PASSWORD },
  });
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
  return (await res.json()).token;
}

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

/** Deletes every booking for the user so each test starts from a known state. */
async function apiClearBookings(request, token) {
  const res = await request.delete(`${API_URL}/bookings`, { headers: authHeaders(token) });
  expect(res.ok(), `clear bookings failed: ${res.status()}`).toBeTruthy();
}

/** Returns the first static (seeded) event that still has seats for this user. */
async function apiFindBookableStaticEvent(request, token) {
  const res = await request.get(`${API_URL}/events`, {
    headers: authHeaders(token),
    params:  { page: 1, limit: 50 },
  });
  expect(res.ok()).toBeTruthy();
  const { data } = await res.json();
  const event = data.find((e) => e.isStatic && e.availableSeats >= 2);
  expect(event, 'no static event with free seats').toBeTruthy();
  return event;
}

/** Creates a booking via the API and returns it (includes bookingRef and id). */
async function apiCreateBooking(request, token, eventId, overrides = {}) {
  const res = await request.post(`${API_URL}/bookings`, {
    headers: authHeaders(token),
    data: {
      eventId,
      customerName:  'Flow Tester',
      customerEmail: 'flow.tester@example.com',
      customerPhone: '9876543210',
      quantity:      1,
      ...overrides,
    },
  });
  expect(res.status(), `create booking failed: ${await res.text()}`).toBe(201);
  return (await res.json()).data;
}

/** Makes the browser start authenticated by storing the token before any page script runs. */
async function authenticatePage(page, token) {
  await page.addInitScript((t) => window.localStorage.setItem('eventhub_token', t), token);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Booking flow — critical journeys', () => {
  let token;

  test.beforeEach(async ({ page, request }) => {
    token = await apiLogin(request);
    await apiClearBookings(request, token);
    await authenticatePage(page, token);
  });

  // E2E-1: TC-002, TC-512, TC-001, TC-102, TC-107
  test('E2E-1: books an event and finds it in My Bookings', async ({ page, request }) => {
    // -- Step 1: Pick a bookable static event and find it with the search box (any page of results) --
    const event = await apiFindBookableStaticEvent(request, token);
    await page.goto('/events');
    await page.getByPlaceholder('Search events, venues…').fill(event.title);
    await expect(page).toHaveURL(/[?&]search=/);
    const eventCard = page.getByTestId('event-card').filter({ hasText: event.title }).first();
    await eventCard.getByTestId('book-now-btn').click();
    await expect(page).toHaveURL(new RegExp(`/events/${event.id}$`));

    // -- Step 2: Record the seat count before booking --
    const seats = page.getByText(/^\d+ \/ \d+ seats$/);
    await expect(seats).toBeVisible();
    const [seatsBefore, totalSeats] = (await seats.textContent()).match(/\d+/g).map(Number);

    // -- Step 3: Fill the booking form and confirm --
    await page.getByLabel('Full Name').fill('Flow Tester');
    await page.getByTestId('customer-email').fill('flow.tester@example.com');
    await page.getByPlaceholder('+91 98765 43210').fill('9876543210');
    await page.getByRole('button', { name: 'Confirm Booking' }).click();

    // -- Step 4: Confirmation card shows a ref starting with the title's first letter --
    await expect(page.getByRole('heading', { name: /Booking Confirmed/ })).toBeVisible();
    const refOnConfirmation = page.locator('.booking-ref');
    const expectedPrefix = event.title[0].toUpperCase();
    await expect(refOnConfirmation).toHaveText(new RegExp(`^${expectedPrefix}-[A-Z0-9]{6}$`));
    const bookingRef = (await refOnConfirmation.textContent()).trim();

    // -- Step 5: "View My Bookings" lists the new booking --
    await page.getByRole('link', { name: 'View My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
    const bookingCard = page.getByTestId('booking-card').filter({ hasText: bookingRef });
    await expect(bookingCard).toBeVisible();
    await expect(bookingCard).toContainText(event.title);
    await expect(bookingCard).toContainText('1 ticket');
    await expect(bookingCard).toContainText('confirmed');

    // -- Step 6: The event's seat count dropped by one for this user --
    await page.goto(`/events/${event.id}`);
    await expect(page.getByText(/^\d+ \/ \d+ seats$/)).toHaveText(`${seatsBefore - 1} / ${totalSeats} seats`);
  });

  // E2E-2: TC-003, TC-103
  test('E2E-2: booking detail shows all sections and a single ticket is refund-eligible', async ({ page, request }) => {
    // -- Step 1: Seed a single-ticket booking via the API --
    const event   = await apiFindBookableStaticEvent(request, token);
    const booking = await apiCreateBooking(request, token, event.id, {
      customerName: 'Refund Tester',
      quantity:     1,
    });

    // -- Step 2: Open the booking from My Bookings --
    await page.goto('/bookings');
    const bookingCard = page.getByTestId('booking-card').filter({ hasText: booking.bookingRef });
    await bookingCard.getByRole('link', { name: 'View Details' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings/${booking.id}$`));

    // -- Step 3: Header and breadcrumb identify the booking --
    await expect(page.getByRole('heading', { level: 1, name: event.title })).toBeVisible();
    const breadcrumb = page.getByRole('navigation').filter({ hasText: booking.bookingRef });
    await expect(breadcrumb).toContainText('My Bookings');

    // -- Step 4: Every detail section is rendered with the booking's data --
    for (const section of ['Event Details', 'Customer Details', 'Payment Summary', 'Refund', 'Booking Information']) {
      await expect(page.getByRole('heading', { level: 2, name: section, exact: true })).toBeVisible();
    }
    await expect(page.getByText('Refund Tester')).toBeVisible();
    await expect(page.getByText(`#${booking.id}`)).toBeVisible();

    // Total Paid row only (its parent section also holds "Price per ticket"); expected = price × quantity
    const totalPaidRow = page.locator('div')
      .filter({ has: page.getByText('Total Paid', { exact: true }) })
      .filter({ hasNotText: 'Price per ticket' });
    await expect(totalPaidRow).toContainText(formatPrice(Number(event.price) * booking.quantity));

    // -- Step 5: Refund check shows a spinner, then "Eligible" for a single ticket --
    await page.getByTestId('check-refund-btn').click();
    await expect(page.getByTestId('refund-spinner')).toBeVisible();
    const refundResult = page.getByTestId('refund-result');
    await expect(refundResult).toBeVisible({ timeout: 6000 });
    await expect(refundResult).toContainText('Eligible for refund');
    await expect(refundResult).toContainText('Single-ticket bookings qualify for a full refund');
    await expect(page.getByTestId('refund-spinner')).toBeHidden();
  });

  // E2E-3: TC-004
  test('E2E-3: cancels a booking from its card in My Bookings', async ({ page, request }) => {
    // -- Step 1: Seed two bookings so we can check only the cancelled one disappears --
    const event    = await apiFindBookableStaticEvent(request, token);
    const toCancel = await apiCreateBooking(request, token, event.id);
    const toKeep   = await apiCreateBooking(request, token, event.id);

    // -- Step 2: Open My Bookings; both cards are listed --
    await page.goto('/bookings');
    const cancelCard = page.getByTestId('booking-card').filter({ hasText: toCancel.bookingRef });
    const keepCard   = page.getByTestId('booking-card').filter({ hasText: toKeep.bookingRef });
    await expect(cancelCard).toBeVisible();
    await expect(keepCard).toBeVisible();

    // -- Step 3: Cancel one booking via its card and confirm the dialog --
    await cancelCard.getByTestId('cancel-booking-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this booking?' });
    await expect(dialog).toContainText(toCancel.bookingRef);
    await dialog.getByTestId('confirm-dialog-yes').click();

    // -- Step 4: Success toast; only the cancelled card is gone --
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(cancelCard).toHaveCount(0);
    await expect(keepCard).toBeVisible();

    // -- Step 5: The cancellation persisted on the server --
    const res = await request.get(`${API_URL}/bookings/${toCancel.id}`, { headers: authHeaders(token) });
    expect(res.status()).toBe(404);
  });
});
