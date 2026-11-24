import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'desktop only');

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('employee starts and finishes a shift', async ({ page }) => {
    await signIn(page, 'ali');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Ali');
    await page.getByRole('button', { name: /Start shift/ }).first().click();
    await expect(page.getByRole('button', { name: /Finish shift/ }).first()).toBeVisible();
    await page.getByRole('button', { name: /Finish shift/ }).first().click();
    const confirm = page.getByRole('dialog').getByRole('button', { name: /Finish shift/ });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByRole('button', { name: /Start shift/ }).first()).toBeVisible();
  });

  test('employee cannot open admin pages', async ({ page }) => {
    await signIn(page, 'ali');
    await page.goto('/admin/payroll');
    await expect(page).not.toHaveURL(/\/admin\/payroll/);
  });

  test('owner dashboard shows the insight cards first', async ({ page }) => {
    await signIn(page, 'owner');
    const cards = page.locator('.sc-stagger h2');
    await expect(cards.first()).toHaveText('Labour cost');
    await expect(page.getByRole('heading', { name: 'Hours worked' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pending approvals' })).toBeVisible();
  });

  test('owner opens a person from People', async ({ page }) => {
    await signIn(page, 'owner');
    await page.goto('/admin/people');
    await page.getByRole('button', { name: /Ali Hassan/ }).click();
    await expect(page).toHaveURL(/\/admin\/people\//);
    await expect(page.getByRole('grid', { name: 'Hours per day' })).toBeVisible();
  });

  test('manager adds a timesheet entry', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/admin/timesheets');
    await page.getByRole('button', { name: 'Add entry' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Start').fill('08:00');
    await sheet.getByLabel('End').fill('12:30');
    await sheet.getByRole('button', { name: 'Add entry' }).click();
    await expect(page.getByText('Entry added')).toBeVisible();
    await expect(page.getByText('08:00 – 12:30').first()).toBeVisible();
  });

  test('messages: post in the Team chat', async ({ page }) => {
    await signIn(page, 'lina');
    await page.goto('/messages');
    await page.getByRole('region', { name: 'Chats' }).getByRole('button', { name: /Team/ }).first().click();
    await page.getByPlaceholder('Message the team').fill('Hello from the test');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByRole('region', { name: /Chat with/ }).getByText('Hello from the test').first()).toBeVisible();
  });

  test('owner saves settings', async ({ page }) => {
    await signIn(page, 'owner');
    await page.goto('/admin/settings');
    await page.getByLabel('Company name').fill('Test Café');
    await expect(page.getByText('Unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    await expect(page.getByText('Unsaved changes')).toHaveCount(0);
  });

  test('reports: save a view', async ({ page }) => {
    await signIn(page, 'manager');
    await page.goto('/admin/reports');
    await page.getByRole('button', { name: 'By week' }).click();
    await page.getByRole('button', { name: /Save this view/ }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('Weekly hours');
    await page.getByRole('dialog').getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('button', { name: 'Weekly hours', exact: true })).toBeVisible();
  });
});
