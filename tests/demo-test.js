/* Demo-truck test for every mode. Runs on every push and pull request (GitHub Actions), and locally:
     npm i playwright && npx playwright install chromium   (once)
     node tests/demo-test.js
   Checks: connecting reads the vehicle by itself; each option (Read codes, Check-In, Auction, Trade) shows its
   own steps, idles, drives and shows its result; saved scans open a summary; Auction and Trade never call monday.com;
   no mode ever sends mode 04 (clear codes); old Check-In/Acquisition data carries over. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  // Also serve the app under /lcc-vehicle-scan-test/ to check the test copy keeps its own data
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/lcc-vehicle-scan-test\//, '/'); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const SHOTS = process.env.SHOTS || '';
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; };

async function runMode(browser, base, mode) {
  console.log('\n' + mode);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const page = await ctx.newPage();
  const monday = [], errors = [];
  await page.route('https://api.monday.com/**', (r) => { monday.push(r.request().url()); r.abort(); });
  await page.route(/nhtsa\.(dot\.)?gov|fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(e.message));
  // Record every command the app sends to the (demo) scanner
  await page.addInitScript(() => {
    window.__sent = [];
    const wait = setInterval(() => {
      if (!window.OBD) return; clearInterval(wait);
      const w = window.OBD.DemoTransport.prototype.write;
      window.OBD.DemoTransport.prototype.write = function (s) { window.__sent.push(String(s).trim().toUpperCase().replace(/\s+/g, '')); return w.call(this, s); };
    }, 5);
  });
  // Trade opens from its home-screen shortcut (?mode=trade); the others pick from the list after the read
  const viaLink = mode === 'trade';
  await page.goto(base + (viaLink ? '?mode=trade' : ''));
  ok(await page.isVisible('#splash'), 'loading screen shows');
  await page.waitForSelector('#splash', { state: 'detached', timeout: 6000 });
  ok(true, 'loading screen goes away by itself');
  ok((await page.textContent('#modeTitle')) === 'Vehicle Scan' && await page.isVisible('#connectBtn'), 'start screen: Connect scanner, no mode picked yet');
  ok(!(await page.isVisible('#pickCard')), 'nothing to pick before a vehicle is read');
  await page.click('#demoBtn');
  await page.waitForSelector('#connPill.demo');
  if (!viaLink) await page.waitForSelector('#pickCard:not(.hidden)', { timeout: 90000 });
  else await page.waitForSelector('#resultCard:not(.hidden)', { timeout: 90000 });
  ok(true, 'vehicle read by itself after connecting');
  ok(/1FTEW1EP4JFD00042/.test(await page.textContent('#vehFacts')), 'VIN shown in the vehicle card');
  ok((await page.inputValue('#miles')) !== '', 'miles filled from the truck');
  if (!viaLink) {
    ok((await page.$$('#pickList button')).length === 4, 'four options: Read codes, Check-In, Auction, Trade');
    await page.click('#pick-' + mode);
  } else ok(true, 'home-screen shortcut went straight to Trade');
  await page.waitForSelector('#resultCard:not(.hidden)');
  ok(!/Vehicle Scan/.test(await page.textContent('#modeTitle')), 'opens in ' + mode + ': ' + await page.textContent('#modeTitle'));
  ok(await page.isVisible('#vehLine') && (await page.textContent('#vehLine')).length > 3, 'vehicle line at the top: ' + await page.textContent('#vehLine'));
  if (mode === 'checkin' || mode === 'codes') ok((await page.inputValue('#stock')).length === 6, 'Stock # = last 6 of VIN: ' + await page.inputValue('#stock'));
  else ok((await page.inputValue('#stock')) === '', 'lane/deal # left for the user');

  if (mode === 'codes') {
    ok(!(await page.isVisible('#idleCard')) && !(await page.isVisible('#driveCard')) && !(await page.isVisible('#estBox')), 'Read codes: no battery/idle, drive or estimate');
    ok(await page.isVisible('#shareBtn'), 'Read codes: share button shown');
  } else {
    ok(await page.isVisible('#idleCard') && await page.isVisible('#driveCard'), 'battery/idle and drive steps shown');
  }
  if (mode === 'auction' || mode === 'trade') {
    ok(await page.isVisible('#callCard'), 'the call shown right after picking');
    ok(/15-second/.test(await page.textContent('#idleBtn')), 'quick 15-second idle check');
    await page.click('#idleBtn');
    await page.waitForSelector('#idleResult:not(.hidden)', { timeout: 60000 });
    ok(/Active misfire on cylinder 3/.test(await page.textContent('#idleFindings')), 'active misfire found on the demo truck, cylinder 3');
  }
  if (mode !== 'codes') {
  await page.click('#driveBtn');
  await page.waitForTimeout(14000);
  await page.click('#driveEnd');
  await page.waitForSelector('#driveResult:not(.hidden)', { timeout: 30000 });
  ok(true, 'drive recorded: ' + (await page.textContent('#driveVerdict')).trim());
  if (mode === 'checkin') {
    ok(await page.isVisible('#feltBox'), 'shift blip asks whether it felt like it slipped');
    await page.click('#feltNo');
    ok(/no slip felt/i.test(await page.textContent('#driveFindings')), 'answering No marks it fine: ' + (await page.textContent('#driveVerdict')).trim());
  }
  ok((await page.textContent('#estTotal')) !== '', 'estimate total ' + await page.textContent('#estTotal'));
  }

  if (mode === 'checkin') {
    ok(await page.isVisible('#sendBtn'), 'Send to monday.com shown');
    ok(!(await page.isVisible('#callCard')), 'no bid/offer card');
    ok(/Practice scan/.test(await page.textContent('#matchBox')), 'demo scan does not post to monday.com');
  } else if (mode === 'codes') {
    ok(!(await page.isVisible('#sendBtn')) && !(await page.isVisible('#callCard')), 'no monday.com button, no bid/offer');
  } else {
    ok(!(await page.isVisible('#sendBtn')), 'no monday.com button');
    await page.fill('#salePrice', '30000');
    if (mode === 'trade') await page.fill('#payoff', '20000');
    await page.waitForTimeout(200);
    const amt = await page.textContent('#callBidAmt');
    ok(/\$|None/.test(amt), (mode === 'trade' ? 'trade offer ' : 'max bid ') + amt + ' (' + (await page.textContent('#callWord')) + ')');
    if (mode === 'trade') {
      ok(await page.isVisible('#callEquity'), 'payoff/equity shown: ' + await page.textContent('#callEquity'));
      ok(await page.isVisible('#custBtn'), 'customer copy button shown');
    } else ok(!(await page.isVisible('#custBtn')), 'no customer copy button');
  }
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, mode + '.png'), fullPage: true });
  ok((await page.$$('#hist li')).length >= 1, 'saved in recent list');
  await page.click('#hist li .histopen');
  await page.waitForSelector('#sumDlg[open]');
  ok((await page.textContent('#sumBody')).length > 100, 'tapping a recent scan opens its summary');
  await page.click('#sumClose');
  if (mode !== 'checkin') {
    await page.click('#nextBtn'); await page.waitForTimeout(300);
    ok(!(await page.isVisible('#resultCard')) && (await page.textContent('#modeTitle')) === 'Vehicle Scan', 'next vehicle goes back to the start');
  }
  const sent = await page.evaluate(() => window.__sent);
  ok(sent.length > 20, sent.length + ' scanner commands sent');
  ok(!sent.some((c) => c === '04' || /^04/.test(c)), 'never sent mode 04 (clear codes)');
  ok(monday.length === 0, 'no monday.com calls from the demo truck (' + monday.length + ')');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

async function migration(browser, base) {
  console.log('\nmigration from the old apps');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route(/nhtsa|fonts\.|monday/, (r) => r.abort());
  await page.goto(base + 'tests/blank.html');
  await page.evaluate(() => {
    localStorage.setItem('lccScan.settings', JSON.stringify({ name: 'Dylan', token: 'tok', fill: true }));
    localStorage.setItem('lccScan.history', JSON.stringify([{ id: 'a1', at: new Date().toISOString(), vin: '1FTEW1EP0KFA00001', stock: 'A00001', assessment: { overall: 'good', findings: [] }, scan: {} }]));
    localStorage.setItem('lccAcq.settings', JSON.stringify({ name: 'Jonathan', minProfit: 3000, fees: 150 }));
    localStorage.setItem('lccAcq.history', JSON.stringify([{ id: 'b1', at: new Date().toISOString(), vin: '1FTEW1EP0KFA00002', assessment: { overall: 'watch', findings: [] }, scan: {} }]));
  });
  await page.goto(base);
  ok((await page.textContent('#modeTitle')) === 'Vehicle Scan', 'opens to the start screen');
  ok((await page.$$('#hist li')).length === 2, 'start screen lists the carried-over scans');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('lccVS.settings')));
  ok(s.token === 'tok' && s.name === 'Dylan', 'token and name carried over');
  ok(s.per.auction.minProfit === 3000 && s.per.auction.fees === 150, 'auction profit and fees carried over');
  const h = await page.evaluate(() => JSON.parse(localStorage.getItem('lccVS.history')));
  ok(h.length === 2 && h.find((r) => r.id === 'a1').mode === 'checkin' && h.find((r) => r.id === 'b1').mode === 'auction', 'both histories carried over, tagged by mode');
  ok(await page.evaluate(() => localStorage.getItem('lccScan.settings') !== null && localStorage.getItem('lccAcq.history') !== null), 'old keys left alone');
  await ctx.close();
}

async function testCopy(browser, base) {
  console.log('\ntest copy');
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
  const page = await ctx.newPage();
  await page.route(/nhtsa\.(dot\.)?gov|fonts\.(googleapis|gstatic)\.com|api\.monday\.com/, (r) => r.abort());
  await page.goto(base + 'tests/blank.html');
  await page.evaluate(() => {
    localStorage.setItem('lccVS.settings', JSON.stringify({ name: 'Dylan', token: 'tok', fill: true, per: {} }));
    localStorage.setItem('lccVS.history', JSON.stringify([{ id: 'live1', mode: 'checkin', at: new Date().toISOString(), assessment: { overall: 'good', findings: [] }, scan: {} }]));
    localStorage.setItem('lccVS.mode', JSON.stringify('checkin'));
  });
  await page.goto(base + 'lcc-vehicle-scan-test/?mode=auction');
  ok(await page.isVisible('.testbar'), 'TEST banner shows');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('lccVST.settings')));
  ok(st && st.token === 'tok', 'test copy borrows the live token');
  const lv = await page.evaluate(() => ({ h: JSON.parse(localStorage.getItem('lccVS.history')), m: JSON.parse(localStorage.getItem('lccVS.mode')), th: localStorage.getItem('lccVST.history') }));
  ok(lv.h.length === 1 && lv.h[0].id === 'live1' && lv.m === 'checkin', 'live app data untouched (history and mode)');
  ok(!lv.th || !JSON.parse(lv.th).some((r) => r.id === 'live1'), 'test copy keeps its own history');
  await page.goto(base);
  ok(!(await page.isVisible('.testbar')), 'no TEST banner on the live address');
  await ctx.close();
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  try {
    await migration(browser, base);
    await testCopy(browser, base);
    for (const m of (process.env.MODES || 'codes checkin auction trade').split(' ')) await runMode(browser, base, m);
  } catch (e) { console.log('  FAIL ' + e.message); failed++; }
  await browser.close(); server.close();
  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nAll checks passed');
  process.exit(failed ? 1 : 0);
})();
