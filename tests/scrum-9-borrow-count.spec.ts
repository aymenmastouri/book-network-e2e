import { Browser, Page, expect, test } from '@playwright/test';

/**
 * SCRUM-9 — the borrow count is where members judge a title.
 *
 * The seeded shelf (V2/V4/V5 migrations) decides the expected values:
 *   - "The Adventures of Sherlock Holmes" — exactly one returned (closed) loan
 *   - "Moby-Dick"                         — exactly one active (unreturned) loan
 *   - "Dracula"                           — one returned loan + one active loan
 *   - "The Art of War"                     — never borrowed
 * All four belong to other members, so Carla's shelf shows them all, and the
 * other e2e arcs never touch these books. The test only reads counts, so it is
 * safe to run repeatedly and leaves the world as it found it.
 */

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

/** A book list GET. The first shelf load carries no query. */
const bookListUrl = (url: string) => /\/books(\?|$)/.test(url);
/** A book GET for one book — not the /books/<id>/feedback sub-resource. */
const bookDetailUrl = (url: string) => /\/books\/\d+(?:\?|$)/.test(url);
/** A book list GET whose search term is exactly the searched title. */
function isSearchFor(url: string, title: string): boolean {
  const m = /q=([^&]*)/.exec(url);
  return /\/books\?/.test(url) && !!m && decodeURIComponent(m[1]) === title;
}

interface BookDto {
  id?: number;
  title?: string;
  borrowCount?: number;
  [key: string]: unknown;
}

/** Re-fetch the shelf and hand back the book list API's response body. */
async function shelfJson(page: Page): Promise<any> {
  const loaded = page.waitForResponse(
    (r) => r.request().method() === 'GET' && bookListUrl(r.url()));
  await page.goto('/');
  return (await (await loaded).json());
}

/** The books of a book list API response body. */
function booksOf(json: any): BookDto[] {
  return Array.isArray(json) ? json : json.content ?? [];
}

/** Every book on the community shelf, following the paginator. */
async function allShelfBooks(page: Page): Promise<BookDto[]> {
  const first = await shelfJson(page);
  const all = booksOf(first);
  let seen = 1;
  while ((first.totalPages ?? 0) > seen) {
    const next = page.waitForResponse(
      (r) => r.request().method() === 'GET' && bookListUrl(r.url()));
    await page.getByRole('button', { name: 'Next' }).click();
    const json = await (await next).json();
    all.push(...booksOf(json));
    seen += 1;
  }
  return all;
}

/** Search the shelf and read the searched book back from the list API. */
async function searchBook(page: Page, title: string): Promise<BookDto> {
  const loaded = page.waitForResponse(
    (r) => r.request().method() === 'GET' && isSearchFor(r.url(), title));
  await page.getByPlaceholder('Search title or author…').fill(title);
  const json = await (await loaded).json();
  const found = booksOf(json).find((b) => b.title === title);
  expect(found, `book "${title}" missing from the book list API`).toBeDefined();
  return found!;
}

/** Open a book's detail page through search and read the detail API's body. */
async function openDetail(page: Page, title: string): Promise<BookDto> {
  await page.goto('/');
  await page.getByPlaceholder('Search title or author…').fill(title);
  const card = page.locator('article').filter({ hasText: title }).first();
  await expect(card).toBeVisible();
  const loaded = page.waitForResponse(
    (r) => r.request().method() === 'GET' && bookDetailUrl(r.url()));
  await card.getByRole('link', { name: title, exact: true }).first().click();
  await expect(page).toHaveURL(/\/books\/\d+/);
  return (await (await loaded).json()) as BookDto;
}

test('[AC1] the book API returns a borrow count for every book it returns', async ({ browser }) => {
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  const books = await allShelfBooks(carla);
  expect(books.length).toBeGreaterThan(0);
  for (const book of books) {
    expect(Number.isInteger(book.borrowCount),
      `book "${book.title}" has no integer borrowCount: ${JSON.stringify(book)}`)
      .toBeTruthy();
    expect(book.borrowCount).toBeGreaterThanOrEqual(0);
  }

  await carla.context().close();
});

test('[AC2] the count reflects both returned and active borrow records', async ({ browser }) => {
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  // Seed: Alice borrowed Ben's Sherlock Holmes, returned it, he approved.
  // Returned records count: the book shows 1, not 0.
  const sherlock = await searchBook(carla, 'The Adventures of Sherlock Holmes');
  expect(sherlock.borrowCount).toBe(1);

  // Seed: Ben borrowed Alice's Moby-Dick and never returned it.
  // Active records count: the book shows 1.
  const moby = await searchBook(carla, 'Moby-Dick');
  expect(moby.borrowCount).toBe(1);

  // Seed: Aymen's closed loan plus Carla's live overdue loan — both states,
  // so the count is the sum over all borrow records: 2.
  const dracula = await searchBook(carla, 'Dracula');
  expect(dracula.borrowCount).toBe(2);

  await carla.context().close();
});

test('[AC3] the book detail view shows the count with a label a member understands', async ({ browser }) => {
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  await openDetail(carla, 'Dracula');
  // The number, glued to a label that tells the member what it means.
  await expect(carla.locator('main').getByText('2 times borrowed', { exact: true }))
    .toBeVisible();

  await carla.context().close();
});

test('[AC4] a book that was never borrowed shows zero, never an empty field', async ({ browser }) => {
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  // The API says zero…
  const artOfWar = await searchBook(carla, 'The Art of War');
  expect(artOfWar.borrowCount).toBe(0);

  // …and the detail page still fills the field with a visible zero.
  await openDetail(carla, 'The Art of War');
  await expect(carla.locator('main').getByText('0 times borrowed', { exact: true }))
    .toBeVisible();

  await carla.context().close();
});

test('[AC5] the existing book endpoints keep the shape the client already consumes', async ({ browser }) => {
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  // List endpoint: the fields the generated client always reads are still
  // there with the same types — the borrow count is an addition, not a
  // reshuffle of the envelope.
  const books = await allShelfBooks(carla);
  expect(books.length).toBeGreaterThan(0);
  for (const book of books) {
    expect(typeof book.id).toBe('number');
    expect(typeof book.title).toBe('string');
    expect(typeof book.authorName).toBe('string');
    expect(typeof book.genre).toBe('string');
    expect(typeof book.isbn).toBe('string');
    expect(typeof book.ownerName).toBe('string');
    expect(typeof book.borrowed).toBe('boolean');
  }

  // Detail endpoint: same story — the response still carries everything the
  // book detail view has always rendered.
  const detail = await openDetail(carla, 'Dracula');
  expect(typeof detail.title).toBe('string');
  expect(detail.title).toBe('Dracula');
  expect(detail.authorName).toBe('Bram Stoker');
  expect(detail.genre).toBe('FANTASY');
  expect(detail.synopsis).toContain('Transylvania');

  // And the view still renders the pre-existing fields next to the new count.
  await expect(carla.locator('main').getByText('Bram Stoker', { exact: true })).toBeVisible();
  await expect(carla.locator('main').getByText('Fantasy', { exact: true })).toBeVisible();
  await expect(carla.locator('main').getByText('9780141439846')).toBeVisible();
  await expect(carla.locator('main').getByText('shared by Ben Okafor')).toBeVisible();
  await expect(carla.locator('main').getByText('Letters and diaries trace a count from Transylvania to London.'))
    .toBeVisible();

  await carla.context().close();
});
