import { test, expect } from '@playwright/test';

// The guest dashboard is served by the api at :8001/guest/ (not the app baseURL), and the dev
// server started by playwright.config runs it with GUEST_DEV=1 + the mock broker. Against the live
// site the surface is OAuth-gated and :8001 is not exposed, so this spec runs on local dev only.
const isLocalDev = (process.env.BASE_URL ?? 'http://localhost:3000') === 'http://localhost:3000';
const GUEST_URL = process.env.GUEST_URL ?? 'http://localhost:8001/guest/';

test.describe('guest controls (GUEST_DEV mock)', () => {
  test.skip(!isLocalDev, 'guest mock runs against local dev only, not the OAuth-gated live site');

  test('toggling a light optimistically flips, then shows verified', async ({ page }) => {
    await page.goto(GUEST_URL);

    const row = page.locator('.light').filter({ has: page.locator('input[data-key]:not([disabled])') }).first();
    const sw = row.locator('input[data-key]');
    await expect(sw).toBeVisible(); // fails fast if the mock dashboard did not render
    const before = await sw.isChecked();

    await sw.click();
    await expect(sw).toBeChecked({ checked: !before }); // optimistic flip is immediate
    await expect(row).toHaveClass(/\bok\b/); // broker verify resolved -> the verified tick
    await expect(sw).toBeChecked({ checked: !before }); // stayed flipped (not reverted as unconfirmed)
  });
});
