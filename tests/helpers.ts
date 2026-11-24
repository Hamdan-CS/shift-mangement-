import type { Page } from '@playwright/test';

/** Demo mode: any password works for owner, manager, ali, lina, yusuf. */
export async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.locator('#login-password').fill('demo-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
