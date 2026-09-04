import { Browser, Page, expect, test } from '@playwright/test';

/** Search, genre filter and the wishlist — the discovery loop. */

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

test('search narrows, genres filter, and the wishlist remembers', async ({ browser }) => {
  const alice = await signIn(browser, 'alice@booknetwork.dev');

  // Search finds Carla's Austen; Alice's own Austen titles stay off the shelf.
  await alice.getByPlaceholder('Search title or author…').fill('austen');
  await expect(alice.locator('article').filter({ hasText: 'Emma' })).toBeVisible();
  await expect(alice.locator('article').filter({ hasText: 'Persuasion' })).toHaveCount(0);

  // The crime chip narrows to detective fiction.
  await alice.getByPlaceholder('Search title or author…').clear();
  await alice.getByRole('button', { name: 'Crime', exact: true }).click();
  await expect(alice.locator('article').filter({ hasText: 'Sherlock' }).first()).toBeVisible();
  await expect(alice.locator('article').filter({ hasText: 'Emma' })).toHaveCount(0);

  // Wishlist: bookmark Emma, find it on the wishlist page, remove it again.
  // (A crashed earlier run may have left Emma bookmarked — then just proceed.)
  await alice.getByRole('button', { name: 'All genres' }).click();
  const emma = alice.locator('article').filter({ hasText: 'Emma' });
  await expect(emma).toBeVisible();
  if (await emma.getByRole('button', { name: 'Add to wishlist' }).count()) {
    await emma.getByRole('button', { name: 'Add to wishlist' }).click();
  }
  await alice.getByRole('link', { name: 'Wishlist' }).click();
  await expect(alice.locator('article').filter({ hasText: 'Emma' })).toBeVisible();
  await alice.locator('article').filter({ hasText: 'Emma' })
    .getByRole('button', { name: 'Remove from wishlist' }).click();
  // Emma is gone; the seeded wishlist entry (The War of the Worlds) remains.
  await expect(alice.locator('article').filter({ hasText: 'Emma' })).toHaveCount(0);

  await alice.context().close();
});
