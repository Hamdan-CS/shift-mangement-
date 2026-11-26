import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Pay rules (migration 018; demo mode uses the same maths):
 * late by 30 min or less → paid from the shift start; later → from the real clock-in;
 * time after the planned shift end → overtime at the person's overtime rate.
 */
test('late ≤ 30 min is paid from the shift start, time after the shift is overtime', async ({ page }) => {
  await signIn(page, 'owner');
  const r = await page.evaluate(async () => {
    const pay = await import('/src/services/pay.ts');
    const { zoned } = await import('/src/utils/tz.ts');
    const tz = 'Europe/Warsaw';
    const day = '2026-11-18', day2 = '2026-11-19';
    const at = (d: string, hm: string) => zoned(d, hm, tz).toISOString();
    localStorage.setItem('shiftclock-demo-shifts', JSON.stringify([
      { id: 's1', week_id: 'w', user_id: 'demo-ali', date: day, start_time: '09:00:00', end_time: '17:00:00', note: null, edited_by: null },
      { id: 's2', week_id: 'w', user_id: 'demo-ali', date: day2, start_time: '21:00:00', end_time: '04:00:00', note: null, edited_by: null },
    ]));
    const e = (id: string, a: string, b: string) => ({ id, user_id: 'demo-ali', clock_in: a, clock_out: b, method: 'qr', location_id: null, break_minutes: 0, note: null, edited: false, created_at: a });
    localStorage.setItem('shiftclock-demo-entries', JSON.stringify([
      e('e1', at(day, '09:20'), at(day, '18:00')),                 // 20 min late (forgiven), 1 h after the shift
      e('e2', at(day2, '21:35'), at('2026-11-20', '04:00')),       // 35 min late (not forgiven), night shift ends on time
    ]));
    const days = (await pay.fetchPayDays(day, day2)).filter((d) => d.user_id === 'demo-ali');
    const rep = (await pay.fetchPayReport(day, day2)).find((x) => x.user_id === 'demo-ali')!;
    return { days: days.map((d) => ({ day: d.day, minutes: d.minutes, grace: d.grace_minutes, ot: d.overtime_minutes })), reg: rep.regular_minutes, ot: rep.overtime_minutes, gross: rep.gross, rate: rep.rate };
  });
  // day 1: paid 09:00–18:00 = 540 min, of which 60 after the shift end
  expect(r.days[0]).toEqual({ day: '2026-11-18', minutes: 540, grace: 20, ot: 60 });
  // night shift: 35 min late → paid from 21:35 to 04:00 = 385 min, no overtime
  expect(r.days[1]).toEqual({ day: '2026-11-19', minutes: 385, grace: 0, ot: 0 });
  expect(r.ot).toBe(60);
  expect(r.reg).toBe(480 + 385);
  expect(r.gross).toBeCloseTo((r.rate! * 865) / 60 + (r.rate! * 1.5 * 60) / 60, 2);
});
