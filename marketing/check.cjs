// Checks the guide's print layout: every page screenshotted at A4 (print media),
// anything spilling out of its page, and images shown smaller than their pixels allow.
// Run: npx playwright-cli run-code --filename=marketing/check.cjs
async page => {
  const dir = 'C:/Users/HP/Downloads/employee dashboard/marketing';
  const ctx = await page.context().browser().newContext({ viewport: { width: 688, height: 1006 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto('file:///' + dir + '/guide.html', { waitUntil: 'load' });
  await p.emulateMedia({ media: 'print' });
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: 'body{background:#ddd} .page{background:#fff;margin:0 0 8px}' });
  const report = await p.evaluate(() => {
    const out = [];
    document.querySelectorAll('section.page').forEach((sec, i) => {
      const pb = sec.getBoundingClientRect();
      sec.querySelectorAll('*').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height && r.bottom > pb.bottom + 1 && getComputedStyle(el).position !== 'absolute') out.push(`page ${i + 1}: <${el.tagName.toLowerCase()} class="${el.className}"> ends ${Math.round(r.bottom - pb.bottom)}px below the page`);
      });
      sec.querySelectorAll('img').forEach((img) => {
        const shown = img.getBoundingClientRect().width * 300 / 96; // pixels needed at 300 dpi
        if (img.naturalWidth && img.naturalWidth < shown * 0.6) out.push(`page ${i + 1}: ${img.getAttribute('src')} may print soft (${img.naturalWidth}px for ${Math.round(shown)}px at 300dpi)`);
        if (!img.complete || !img.naturalWidth) out.push(`page ${i + 1}: image not loaded ${img.getAttribute('src')}`);
      });
      const free = pb.bottom - Math.max(...[...sec.children].map((c) => c.getBoundingClientRect().bottom));
      out.push(`page ${i + 1}: free space at bottom ${Math.round(free)}px of ${Math.round(pb.height)}px`);
    });
    return out;
  });
  const n = await p.locator('section.page').count();
  for (let i = 0; i < n; i++) await p.locator('section.page').nth(i).screenshot({ path: `${dir}/check/page-${String(i + 1).padStart(2, '0')}.png` });
  await ctx.close();
  return report.join('\n');
}
