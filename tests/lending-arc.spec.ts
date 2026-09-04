import { Browser, Page, expect, test } from '@playwright/test';

/**
 * The whole lending arc, with both seeded members playing their roles:
 * Alice borrows Ben's book and returns it; Ben approves the return, which
 * makes the book available again — so the test leaves the world as it
 * found it and can run repeatedly.
 */

const BOOK = 'The Time Machine';

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
  await expect(card(page)).toBeVisible();
}

test('a book travels from shelf to reader and home again', async ({ browser }) => {
  const alice = await signIn(browser, 'alice@booknetwork.dev');

  // Alice finds Ben's book on the community shelf and borrows it.
  await searchFor(alice);
  await card(alice).getByRole('button', { name: 'Borrow' }).click();
  await expect(card(alice).getByText('With you')).toBeVisible();

  // It shows up under her borrowed books; she returns it.
  await alice.getByRole('link', { name: 'Borrowed' }).click();
  const loanRow = alice.locator('li').filter({ hasText: BOOK }).first();
  await loanRow.getByRole('button', { name: 'Return' }).click();
  await expect(loanRow.getByText('Waiting for approval')).toBeVisible();

  // Ben sees the return of his own book and approves it.
  const ben = await signIn(browser, 'ben@booknetwork.dev');
  await ben.getByRole('link', { name: 'Returns' }).click();
  const returnRow = ben.locator('li').filter({ hasText: BOOK }).first();
  await returnRow.getByRole('button', { name: 'Approve return' }).click();
  await expect(returnRow.getByText('Approved')).toBeVisible();

  // Approval frees the book: Alice can see it as available again.
  await alice.getByRole('link', { name: 'Browse' }).click();
  await searchFor(alice);
  await expect(card(alice).getByText('Available')).toBeVisible();

  await alice.context().close();
  await ben.context().close();
});
