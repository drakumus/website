import { test, expect, type Page } from '@playwright/test';

// Visual-regression baselines replace the by-hand "screenshot desktop + mobile and compare against
// the existing surface" pass done through Playwright MCP (which spends model credits). Baselines are
// committed PNGs; the runner pixel-diffs against them for free. Re-bless intentionally after a look
// change: `npx playwright test tests/visual.spec.ts --update-snapshots`.
//
// Scoped to the desktop project and to single framed elements (not full pages) so the baselines are
// small and deterministic: no scroll, no whileInView timing, and CSS animations are frozen to their
// end state by `animations: 'disabled'`. Only the two public surfaces are captured: they have no
// mutable state. The guest room reflects live switch state (guest.spec toggles the shared mock), so
// a guest baseline would flake; its look is the same shared gold-frame theme as the portfolio card,
// and its command-to-verify behaviour is covered functionally in guest.spec.ts.
const shot = { animations: 'disabled', maxDiffPixelRatio: 0.01 } as const;

// Let fonts load and the entrance motion (~0.45s) settle before capturing.
async function settle(page: Page) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await page.waitForTimeout(900);
}

test.describe('visual regression', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop baseline only');
  });

  test('landing destination card', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    await expect(page.locator('.destination-card').first()).toHaveScreenshot('landing-card.png', shot);
  });

  test('portfolio project card', async ({ page }) => {
    await page.goto('/portfolio');
    await settle(page);
    await expect(page.locator('.project-card').first()).toHaveScreenshot('portfolio-card.png', shot);
  });
});
