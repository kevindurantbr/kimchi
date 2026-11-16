// Records real clips of the live Kimchi dashboard (CDP screencast), one folder of frames per segment.
const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'https://kevindurantbr.github.io/kimchi/';
const CURSOR = `
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.id = '__cur';
  c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform 0s';
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20.5 L13.4 19.2 L10.4 12.6 L16.5 12.6 Z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(c);
  addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX-3) + 'px,' + (e.clientY-2) + 'px)'; }, true);
  addEventListener('mousedown', () => { c.firstChild.style.transform='scale(.85)'; }, true);
  addEventListener('mouseup', () => { c.firstChild.style.transform=''; }, true);
});`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(CURSOR);
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await p.waitForTimeout(5000);
  const cdp = await ctx.newCDPSession(p);
  let seg = null, n = 0;
  cdp.on('Page.screencastFrame', async (f) => {
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    if (!seg) return;
    const name = `${seg}/${String(n++).padStart(5, '0')}_${f.metadata.timestamp.toFixed(4)}.jpg`;
    fs.writeFileSync(name, Buffer.from(f.data, 'base64'));
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  const start = async (name) => { fs.rmSync(name, { recursive: true, force: true }); fs.mkdirSync(name); n = 0; seg = name; };
  const stop = async () => { seg = null; };
  const glide = async (x, y, steps = 25) => p.mouse.move(x, y, { steps });
  const box = async (sel) => (await p.locator(sel).first().boundingBox());

  await p.mouse.move(900, 700);
  // A: the map, hovering the pivots (badges roll out)
  await start('A_map');
  await p.waitForTimeout(400);
  await glide(705, 488, 40); await p.waitForTimeout(1600);
  await glide(810, 594, 30); await p.waitForTimeout(1600);
  await glide(705, 488, 30); await p.waitForTimeout(800);
  await stop();

  // B: the four factor checks
  await start('B_factors');
  const cards = p.locator('#cards > *');
  const cnt = await cards.count();
  console.log('cards', cnt);
  for (let i = 1; i < Math.min(cnt, 4); i++) {
    const bb = await cards.nth(i).boundingBox();
    if (!bb || bb.y > 860) { await p.locator('#left').evaluate((el, k) => el.scrollBy({ top: 260, behavior: 'smooth' })); await p.waitForTimeout(500); }
    const bb2 = await cards.nth(i).boundingBox();
    await glide(bb2.x + 120, Math.min(bb2.y + 30, 880), 20);
    await p.mouse.down(); await p.mouse.up();
    await p.waitForTimeout(1300);
  }
  await stop();
  // back to water balance
  await p.locator('#left').evaluate(el => el.scrollTo({ top: 0 }));
  await cards.nth(0).click(); await p.waitForTimeout(1200);

  // C: play the time slider
  const range = await box('#sl-range');
  await p.locator('#sl-range').evaluate(el => { el.value = el.min; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(1200);
  const play = await box('#sl-play');
  await start('C_play');
  await glide(play.x + play.width / 2, play.y + play.height / 2, 20);
  await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(16500);
  await stop();
  console.log('slider label', await p.$eval('#sl-label', e => e.textContent));

  // D: open the first action
  const h0 = await box('#acth-0');
  await start('D_actions');
  await glide(h0.x + h0.width / 2, h0.y + h0.height / 2, 30);
  await p.waitForTimeout(300);
  await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(3600);
  await stop();

  // E: rotations
  await start('E_rotations');
  await glide(1250, 600, 15);
  for (let k = 0; k < 6; k++) { await p.mouse.wheel(0, 160); await p.waitForTimeout(260); }
  await p.waitForTimeout(1200);
  const det = p.locator('#rotations details summary').first();
  if (await det.count()) { const db = await det.boundingBox(); if (db && db.y < 880) { await glide(db.x + 60, db.y + db.height / 2, 20); await p.mouse.down(); await p.mouse.up(); } }
  await p.waitForTimeout(2200);
  await stop();

  // F: Complete view
  await p.locator('#right').evaluate(el => el.scrollTo({ top: 0 }));
  await p.waitForTimeout(600);
  const comp = p.getByText('Complete', { exact: true }).first();
  const cb = await comp.boundingBox();
  await start('F_complete');
  await glide(cb.x + cb.width / 2, cb.y + cb.height / 2, 25);
  await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(3200);
  await stop();

  // G: season report
  const rb = await box('#btn-report');
  await start('G_report');
  await glide(rb.x + rb.width / 2, rb.y + rb.height / 2, 25);
  await p.mouse.down(); await p.mouse.up();
  await p.waitForTimeout(3200);
  await stop();

  await cdp.send('Page.stopScreencast');
  await b.close();
})();
