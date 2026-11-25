import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('phone: tab bar, no sideways scroll, sheet opens and closes', async ({ page }) => {
  await signIn(page, 'ali');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await nav.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('phone: pay page has a Copy button', async ({ page }) => {
  await signIn(page, 'ali');
  await page.goto('/pay');
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('phone: Today timeline opens full screen and closes', async ({ page }) => {
  await signIn(page, 'ali');
  await page.goto('/today');
  await page.getByRole('button', { name: 'Full screen' }).click();
  const full = page.getByRole('dialog', { name: /full screen/ });
  await expect(full).toBeVisible();
  await expect(full.getByRole('button', { name: 'Close full screen' })).toBeVisible();
  await full.getByRole('button', { name: 'Close full screen' }).click();
  await expect(full).toHaveCount(0);
});
