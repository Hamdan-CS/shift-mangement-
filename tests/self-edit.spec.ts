import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Owner setting "Staff can edit their own times" (migration 019): an employee
 * changes the clock-in of the shift they are on right now, it is saved at once,
 * shows "Edited by you", and the managers / owner get a notification.
 */
test('staff edit their own clock-in while clocked in, managers are told', async ({ page }) => {
  await signIn(page, 'ali');
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
  const want = await page.evaluate(async (since) => {
    const demo = await import('/src/services/demo.ts');
    demo.DEMO_SETTINGS.staff_edit_times = true;
    localStorage.setItem('shiftclock-demo-entries', JSON.stringify([
      { id: 'open1', user_id: 'demo-ali', clock_in: since, clock_out: null, method: 'qr', location_id: null, break_minutes: 0, note: null, edited: false, created_at: since },
    ]));
    // in-app navigation keeps the setting (a page load would reset the demo settings)
    history.pushState({}, '', '/history');
    dispatchEvent(new PopStateEvent('popstate'));
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - 3 * 3600_000));
  }, twoHoursAgo);

  await page.getByRole('button', { name: /Edit clock-in/ }).click();
  await expect(page.getByRole('dialog').getByText('Edit your times')).toBeVisible();
  await page.getByLabel('Clock in').fill(want);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved. Your manager has been told.')).toBeVisible();
  await expect(page.getByText('Edited by you')).toBeVisible();

  const r = await page.evaluate(() => ({
    entry: JSON.parse(localStorage.getItem('shiftclock-demo-entries') || '[]').find((e: { id: string }) => e.id === 'open1'),
    notes: JSON.parse(localStorage.getItem('shiftclock-demo-notifications') || '[]').filter((n: { type: string }) => n.type === 'time.self_edited'),
  }));
  expect(r.entry.clock_out).toBeNull();               // still working
  expect(r.entry.edited_by).toBe('demo-ali');
  expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(r.entry.clock_in))).toBe(want);
  expect(r.notes.map((n: { recipient_id: string }) => n.recipient_id).sort()).toEqual(['demo-manager', 'demo-owner']);
});
