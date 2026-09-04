import { Browser, Page, expect, test } from '@playwright/test';

/**
 * SCRUM-9: the borrow count. Every book the book API returns carries a
 * `borrowCount` built from ALL of the book's loan rows — returned and active
 * alike; the book detail view shows the number with a label a member
 * understands, and a never-borrowed book shows zero, never an empty field.
 *
 * Ground truth is the seed data (V2/V4/V5 migrations):
 *   Dracula  -> 2 loan rows: one ACTIVE (Carla, overdue) + one closed (Aymen)
 *   Moby-Dick -> 1 loan row: ACTIVE (Ben holds it, not returned yet)
 *   Sherlock Holmes -> 1 loan row: CLOSED (Alice returned, Ben approved)
 *   Emma -> 1 loan row: closed (Ben's finished loan)
 *   The War of the Worlds -> 0 loan rows, never borrowed
 *
 * Note: the community shelf excludes the viewer's OWN books, so each value is
 * read through a viewer who is not the owner of the book in question.
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

/** Pathname of a response URL, or '' if it cannot be parsed. */
function pth(url: string): string {
  try { return new URL(url).pathname; } catch { return ''; }
}
/** A decoded query param of a response URL, or null if unparseable. */
function qp(url: string, name: string): string | null {
  try { return new URL(url).searchParams.get(name); } catch { return null; }
}

interface BookRecord {
  id?: number;
  title?: string;
  authorName?: string;
  borrowCount?: number;
  [key: string]: unknown;
}

/**
 * Search the shelf and read the API's own answer. The response is disambiguated
 * by its `q` query param, so the debounced (250ms) search response is caught
 * — never the earlier, unfiltered page-load response. Reading the JSON keeps
 * this page-independent, like the other suites.
 */
async function searchBook(page: Page, query: string, title: string): Promise<BookRecord> {
  const loaded = page.waitForResponse(
    (r) => pth(r.url()).endsWith('/books') && qp(r.url(), 'q') === query);
  await page.getByPlaceholder('Search title or author…').fill(query);
  const json = (await (await loaded).json()) as { content?: BookRecord[] };
  const match = (json.content ?? []).find((b) => b.title === title);
  expect(match, `API should return "${title}" for q="${query}"`).toBeTruthy();
  return match as BookRecord;
}

/** Open a book's detail view (soft router nav) and return what the detail API answered. */
async function openDetail(page: Page, book: BookRecord): Promise<BookRecord> {
  const detail = page.waitForResponse(
    (r) => pth(r.url()).endsWith(`/books/${book.id}`));
  // The card repeats the title as a link (cover + heading) — take the first.
  await page.locator('article').filter({ hasText: book.title }).first()
    .getByRole('link', { name: book.title }).first().click();
  return (await (await detail).json()) as BookRecord;
}

/** The detail view shows the number with a readable label — never a hole. */
async function expectCountInView(page: Page, count: number): Promise<void> {
  const el = page.getByTestId('book-borrow-count');
  await expect(el, 'a borrow-count line is rendered').toBeVisible();
  const text = (await el.innerText()).trim();
  expect(text, `the count ${count} is shown`).toMatch(new RegExp(`\\b${count}\\b`));
  // More than a bare number: a member-readable label is present (no empty field).
  expect(text, 'the count line has a label, not just a number').not.toBe(String(count));
}

test('[AC1] the book API returns a borrow count for every book it returns', async ({ browser }) => {
  const alice = await signIn(browser, 'alice@booknetwork.dev');

  // Fresh shelf load: every record in the pagination envelope carries the number.
  const shelf = alice.waitForResponse((r) => pth(r.url()).endsWith('/books'));
  await alice.reload();
  const json = (await (await shelf).json()) as { content?: BookRecord[] };
  expect(Array.isArray(json.content), 'the list still paginates in a content array').toBeTruthy();
  expect(json.content as BookRecord[]).not.toHaveLength(0);
  for (const book of json.content as BookRecord[]) {
    expect(typeof book.borrowCount, `borrowCount of "${book.title}"`).toBe('number');
    expect(book.borrowCount as number, `borrowCount of "${book.title}"`).toBeGreaterThanOrEqual(0);
  }

  // A known seeded value through search: Emma's one finished loan shows as 1.
  const emma = await searchBook(alice, 'emma', 'Emma');
  expect(emma.borrowCount).toBe(1);

  await alice.context().close();
});

test('[AC2] the count reflects returned and active borrow records alike', async ({ browser }) => {
  // Carla owns none of these books, so all three appear on her shelf.
  const carla = await signIn(browser, 'carla@booknetwork.dev');

  // Two rows on Dracula — one active (Carla, overdue) and one closed (Aymen).
  const dracula = await searchBook(carla, 'dracula', 'Dracula');
  expect(dracula.borrowCount, 'active + returned rows both count').toBe(2);

  // Moby-Dick: only the still-open loan of Ben.
  const moby = await searchBook(carla, 'moby', 'Moby-Dick');
  expect(moby.borrowCount, 'the active loan counts').toBe(1);

  // Sherlock: only the closed loan of Alice.
  const sherlock = await searchBook(carla, 'sherlock', 'The Adventures of Sherlock Holmes');
  expect(sherlock.borrowCount, 'the returned loan counts').toBe(1);

  await carla.context().close();
});

test('[AC3] the book detail view shows the count with a label', async ({ browser }) => {
  const alice = await signIn(browser, 'alice@booknetwork.dev');
  const dracula = await searchBook(alice, 'dracula', 'Dracula');

  const detail = await openDetail(alice, dracula);
  expect(detail.title).toBe('Dracula');
  expect(detail.borrowCount, 'the detail API answers the same count').toBe(2);

  await expectCountInView(alice, 2);

  await alice.context().close();
});

test('[AC4] a never-borrowed book shows zero, never an empty field', async ({ browser }) => {
  const alice = await signIn(browser, 'alice@booknetwork.dev');
  const worlds = await searchBook(alice, 'war of the worlds', 'The War of the Worlds');
  expect(worlds.borrowCount, 'no loan rows means exactly 0, not absent').toBe(0);

  const detail = await openDetail(alice, worlds);
  expect(detail.borrowCount).toBe(0);

  await expectCountInView(alice, 0);

  await alice.context().close();
});

test('[AC5] existing book endpoints keep their response shape', async ({ browser }) => {
  const alice = await signIn(browser, 'alice@booknetwork.dev');

  // The list endpoint: the pagination envelope and its metadata survive...
  const shelf = alice.waitForResponse((r) => pth(r.url()).endsWith('/books'));
  await alice.reload();
  const json = (await (await shelf).json()) as Record<string, unknown> & { content?: BookRecord[] };
  expect(Array.isArray(json.content), 'the list still paginates in a content array').toBeTruthy();
  expect(['totalElements', 'totalPages', 'size', 'number'].some((k) => json[k] !== undefined),
    '...and the pagination metadata is unchanged').toBeTruthy();

  // ...and every book record keeps its old fields next to the new one.
  const books = json.content as BookRecord[];
  expect(books).not.toHaveLength(0);
  for (const book of books) {
    expect(typeof book.id, `id of "${book.title}"`).toBe('number');
    expect(typeof book.title, `title of "${book.title}"`).toBe('string');
    expect(typeof book.authorName, `authorName of "${book.title}"`).toBe('string');
    expect(typeof book.borrowCount, `borrowCount of "${book.title}"`).toBe('number');
  }

  // The detail endpoint still answers a flat book, not a page envelope.
  const dracula = await searchBook(alice, 'dracula', 'Dracula');
  const detail = await openDetail(alice, dracula);
  expect(typeof detail.title).toBe('string');
  expect((detail as Record<string, unknown>).content, 'the detail is not wrapped in a page').toBeUndefined();

  await alice.context().close();
});
