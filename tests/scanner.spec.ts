import { expect, test } from '@playwright/test';
import path from 'node:path';
import { signIn } from './helpers';

// A fake camera that shows the clock-in QR code (tests/fixtures/clock-qr.y4m, made from clock-qr.png).
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${path.resolve('tests/fixtures/clock-qr.y4m')}`,
    ],
  },
  permissions: ['camera'],
});

test('QR only: staff tap Scan, the camera opens inside the app and clocks them in', async ({ page }) => {
  await signIn(page, 'ali');
  // the owner switched to "QR only" (demo settings live in this page's memory)
  await page.evaluate(async () => { const api = await import('/src/services/api.ts'); await api.updateSettings({ allow_button_clock: false }); });
  await page.getByRole('link', { name: /Today/ }).first().click();
  await page.getByRole('link', { name: /Home|Overview/ }).first().click();

  await expect(page.getByRole('button', { name: /Start shift$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Scan to start shift' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan the QR code' })).toBeVisible();
  // the code is read and the clock page opens, signed in
  await page.waitForURL(/\/clock\?loc=/, { timeout: 15_000 });
  await expect(page.getByText(/clocked in|You're in|Clocked in/i).first()).toBeVisible({ timeout: 15_000 });
});
