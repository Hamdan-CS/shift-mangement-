// Renders the PWA PNG icons from public/icons/*.svg with the playwright-cli browser.
// Run: npx playwright-cli run-code --filename=scripts/visual/icons.cjs
async page => {
  // SVG sources are inlined by the generator (run-code has no fs).
  const SVG = {"public/icons/icon.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" rx=\"116\" fill=\"#2F5BEA\"/><circle cx=\"256\" cy=\"256\" r=\"136\" fill=\"none\" stroke=\"#fff\" stroke-width=\"36\"/><path d=\"M256 184v72l48 30\" fill=\"none\" stroke=\"#fff\" stroke-width=\"36\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>","public/icons/icon-maskable.svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" fill=\"#2F5BEA\"/><circle cx=\"256\" cy=\"256\" r=\"104\" fill=\"none\" stroke=\"#fff\" stroke-width=\"28\"/><path d=\"M256 200v56l38 24\" fill=\"none\" stroke=\"#fff\" stroke-width=\"28\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>"};
  const jobs = [
    { src: 'public/icons/icon.svg', out: 'public/icons/icon-192.png', size: 192, bg: 'transparent' },
    { src: 'public/icons/icon.svg', out: 'public/icons/icon-512.png', size: 512, bg: 'transparent' },
    { src: 'public/icons/icon-maskable.svg', out: 'public/icons/icon-maskable-512.png', size: 512, bg: '#2F5BEA' },
    { src: 'public/icons/icon-maskable.svg', out: 'public/icons/apple-touch-icon.png', size: 180, bg: '#2F5BEA' },
    { src: 'public/icons/icon.svg', out: 'public/icons/favicon-32.png', size: 32, bg: 'transparent' },
  ];
  const done = [];
  for (const j of jobs) {
    const svg = SVG[j.src];
    await page.setViewportSize({ width: j.size, height: j.size });
    await page.setContent(`<html><body style="margin:0;background:${j.bg}">${svg.replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`);
    await page.locator('svg').screenshot({ path: j.out, omitBackground: j.bg === 'transparent' });
    done.push(j.out);
  }
  return done.join('\n');
}
