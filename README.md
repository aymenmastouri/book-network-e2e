# BookNetwork E2E

The Playwright end-to-end suite of BookNetwork, in its own repository. It drives the
running application through the browser and the REST API; it contains no application
code of its own.

The application it tests lives in two sibling repositories: `book-network-api` (Spring
Boot on http://localhost:8088/api/v1, and the shared infrastructure via
`docker compose up -d`) and `book-network-ui` (Angular on http://localhost:4201).
Both must be running before the suite is started.

```bash
npm ci && npx playwright install chromium
npm test                       # the whole suite
npx playwright test <file>     # one file
```

Test files live in `tests/`. The base URL and the demo accounts are declared in
`playwright.config.ts` and in the existing tests; the data the assertions expect is
seeded by the API's Flyway migrations and the Keycloak realm import, both in
`book-network-api`.
