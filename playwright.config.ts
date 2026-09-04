import { defineConfig } from '@playwright/test';

/**
 * Runs against the local stack: docker compose up, backend on 8088, UI on
 * 4201. The suite drives real Keycloak logins with the seeded demo accounts,
 * so a fresh `docker compose up` is all the setup it needs.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4201',
    screenshot: 'only-on-failure',
  },
});
