import { Browser, Page, expect, test } from '@playwright/test';

/**
 * The queue in action, all three members playing their parts: Ben borrows
 * Alice's book, Carla reserves it, and when Alice approves Ben's return the
 * book is lent straight to Carla — she never clicks "borrow". Carla then
 * returns it and Alice approves with an empty queue, so the world ends up
 * exactly as it began. A prologue clears leftovers of a crashed earlier run,
 * so the suite heals itself instead of relying on a pristine stack.
 */

const BOOK = 'Persuasion';

async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByLabel(/E-?Mail/i).fill(email);
  await page.locator('#password').fill('booknetwork');
  await page.locator('#kc-login').click();
  await expect(page.getByRole('link', { name: 'BookNetwork' })).toBeVisible();
  return page;
}

function card(page: Page) {
  return page.locator('article').filter({ hasText: BOOK });
}

/** The shelf paginates, so find the book through search — page-independent. */
async function searchFor(page: Page): Promise<void> {
  await page.getByPlaceholder('Search title or author…').fill(BOOK);
}

interface LoanRow {
  title?: string;
  returned?: boolean;
  approved?: boolean;
}

/**
 * The guards read the page's own API response — the JSON decides whether an
 * action is due, never a "did the button render yet?" heuristic. Clicks then
 * wait for their POST to land, because a click resolves on the DOM event and
 * the next step must not race the server.
 */
async function returnIfHeld(borrower: Page): Promise<void> {
  // goto, not a nav click: clicking "Borrowed" while already on /borrowed is a
  // same-URL navigation the router ignores — no request fires and a
  // waitForResponse would hang. A full load always fetches.
  const loaded = borrower.waitForResponse((r) => r.url().includes('/loans/borrowed'));
  await borrower.goto('/borrowed');
  const rows: LoanRow[] = ((await (await loaded).json()).content ?? []);
  if (!rows.some((l) => l.title === BOOK && !l.returned)) {
    return;
  }
  const done = borrower.waitForResponse(
    (r) => r.url().includes('/return') && r.request().method() === 'POST');
  await borrower.locator('li').filter({ hasText: BOOK }).first()
    .getByRole('button', { name: 'Return' }).click();
  await done;
}

async function approveIfPending(owner: Page): Promise<void> {
  const loaded = owner.waitForResponse((r) => r.url().includes('/loans/returned'));
  await owner.goto('/returns');
  const rows: LoanRow[] = ((await (await loaded).json()).content ?? []);
  if (!rows.some((l) => l.title === BOOK && l.returned && !l.approved)) {
    return;
  }
  const done = owner.waitForResponse(
    (r) => r.url().includes('/approve') && r.request().method() === 'POST');
  await owner.locator('li').filter({ hasText: BOOK }).first()
    .getByRole('button', { name: 'Approve return' }).click();
  await done;
}

test('the queue hands a returned book to the next reader', async ({ browser }) => {
  const ben = await signIn(browser, 'ben@booknetwork.dev');
  const alice = await signIn(browser, 'alice@booknetwork.dev');
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  // Prologue: heal whatever a crashed run left behind.
  await returnIfHeld(ben);
  await returnIfHeld(carla);
  await approveIfPending(alice);

  // Ben borrows Alice's book.
  await ben.getByRole('link', { name: 'Browse' }).click();
  await searchFor(ben);
  await card(ben).getByRole('button', { name: 'Borrow' }).click();
  await expect(card(ben).getByText('With you')).toBeVisible();

  // Carla queues for it and sees her position.
  await carla.getByRole('link', { name: 'Browse' }).click();
  await searchFor(carla);
  await card(carla).getByRole('button', { name: 'Reserve' }).click();
  await expect(card(carla).getByRole('button', { name: 'Leave queue' })).toBeVisible();
  await carla.getByRole('link', { name: 'Borrowed' }).click();
  await expect(carla.locator('li').filter({ hasText: BOOK })
    .getByText('Position 1 in queue')).toBeVisible();

  // Ben returns; Alice approves — and the book flows on to Carla by itself.
  await returnIfHeld(ben);
  await approveIfPending(alice);

  // Carla now holds the book without ever borrowing it herself...
  await carla.goto('/borrowed');
  const carlaLoan = carla.locator('li').filter({ hasText: BOOK }).first();
  await expect(carlaLoan.getByRole('button', { name: 'Return' })).toBeVisible();

  // ...and was told by mail.
  const mails = await (await carla.request.get('http://localhost:1080/api/email')).json();
  const fulfilled = mails.filter(
    (m: { subject?: string; to?: Array<{ address?: string }> }) =>
      m.subject === 'Your reserved book is yours' &&
      m.to?.some((t) => t.address === 'carla@booknetwork.dev')
  );
  expect(fulfilled.length).toBeGreaterThan(0);

  // Restore the world: Carla returns, Alice approves an empty queue.
  await returnIfHeld(carla);
  await approveIfPending(alice);
  const ben2 = await signIn(browser, 'ben@booknetwork.dev');
  await searchFor(ben2);
  await expect(card(ben2).getByText('Available')).toBeVisible();

  await ben.context().close();
  await carla.context().close();
  await alice.context().close();
  await ben2.context().close();
});
