// Exports marketing/guide.html to marketing/ShiftClock-Guide.pdf (A4, backgrounds, 14 mm margins,
// page numbers) and the cover as marketing/ShiftClock-Guide-preview.png (for WhatsApp).
// Run: npx playwright-cli run-code --filename=marketing/export.cjs
async page => {
  const dir = 'C:/Users/HP/Downloads/employee dashboard/marketing';
  const url = 'file:///' + dir + '/guide.html';
  const browser = page.context().browser();
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  await p.pdf({
    path: dir + '/ShiftClock-Guide.pdf',
    format: 'A4', printBackground: true, preferCSSPageSize: false,
    margin: { top: '14mm', right: '14mm', bottom: '16mm', left: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#8b909b;padding:0 14mm;display:flex;justify-content:space-between"><span>ShiftClock for Cookiery PL</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  // cover image for WhatsApp: the first page on a white A4 sheet
  await p.emulateMedia({ media: 'screen' });
  await p.addStyleTag({ content: 'body{padding:14mm;width:210mm} .page{break-after:auto;margin-bottom:40mm}' });
  await p.waitForTimeout(200);
  const first = p.locator('section.page').first();
  const box = await first.boundingBox();
  await p.screenshot({ path: dir + '/ShiftClock-Guide-preview.png', clip: { x: box.x - 53, y: box.y - 53, width: box.width + 106, height: box.height + 106 } });
  const pages = await p.locator('section.page').count();
  await ctx.close();
  return `pdf + preview done, ${pages} pages`;
}
