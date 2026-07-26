import { test, expect } from '@playwright/test';

// Frugal smoke suite (site spec §5): confirm the site works on desktop + both
// mobile devices. Role-based locators, web-first assertions, no manual sleeps.

test('landing is a barren launcher with both destination links', async ({ page }) => {
  await page.goto('/');

  const portfolio = page.getByRole('link', { name: /Portfolio/ });
  await expect(portfolio).toHaveAttribute('href', '/portfolio');

  const jellyfin = page.getByRole('link', { name: /Jellyfin/ });
  await expect(jellyfin).toHaveAttribute('href', 'https://js1.zoci.me');
});

test('portfolio shows identity and opens/closes a project modal', async ({ page }) => {
  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { level: 1, name: 'Rohan Cheeniyil' })).toBeVisible();

  await page.getByRole('button', { name: 'Open Sorrow Bot' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Sorrow Bot' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('landing has no uncaught console/page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.getByRole('link', { name: /Portfolio/ })).toBeVisible();
  expect(errors, `console errors:\n${errors.join('\n')}`).toHaveLength(0);
});
