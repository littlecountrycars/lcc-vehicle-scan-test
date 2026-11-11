/* LCC Vehicle Scan: one app, three modes (Check-In, Auction, Trade).
   Shared screens and logic. Owner: Dylan. Money math (max bid, trade offer) and process changes: Jonathan signs off.
   Mode wording and defaults live in modes/*.js. Only Check-In mode talks to monday.com. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MODES = window.LCC_MODES || {};
  const MODE_ORDER = ['checkin', 'auction', 'trade'].filter((k) => MODES[k]);

  /* ---------- monday.com (Check-In mode only) ---------- */
  const BOARD = '18410463373';           // Inventory Recon (new)
  const SUB_BOARD = '18410479838';       // its subitems board
  const COL = { stock: 'text_mm2txesd', stage: 'color_mm2tny8k', location: 'color_mm2yxmdw', estimate: 'numeric_mm8x1pk1' };
  const SUB = { status: 'color_mm2t1egg', notes: 'long_text_mm2t42xe', parts: 'text_mm2tdxxp' };
  const JONATHAN = '101601751';

  const LEVEL_WORD = { good: 'Good to go', watch: 'Needs a look', problem: 'Needs work' };
  // The test copy (littlecountrycars.github.io/lcc-vehicle-scan-test/) runs this same code. It shares the website,
  // so it keeps its own saved data under lccVST.* and never touches the live app's lccVS.* data.
  const TEST = /-test\//.test(location.pathname);
  const P = TEST ? 'lccVST.' : 'lccVS.';
  const LS = { settings: P + 'settings', hist: P + 'history', port: P + 'lastTransport', mode: P + 'mode', migrated: P + 'migrated' };
  const SCOUT_URL = 'https://claude.ai/artifact/6bBGxC5drP42KJE9sGJYgZ';

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* Bring over what the two old apps saved on this phone (same website, so same storage).
     Reads only; the old keys are left alone. */
  function migrate() {
    if (store.get(LS.migrated, false)) return;
    if (TEST) {
      // Test copy: borrow the live app's name, monday token and settings once. Scan history stays separate.
      const live = store.get('lccVS.settings', null);
      if (live) store.set(LS.settings, JSON.parse(JSON.stringify(live)));
      const m = store.get('lccVS.mode', null); if (m) store.set(LS.mode, m);
      store.set(LS.migrated, true);
      return;
    }
    const s = store.get(LS.settings, null) || {};
    const ci = store.get('lccScan.settings', null), acq = store.get('lccAcq.settings', null);
    if (ci) { s.name = s.name || ci.name || ''; s.token = s.token || ci.token || ''; if (s.fill == null && ci.fill != null) s.fill = ci.fill; }
    if (acq) {
      s.name = s.name || acq.name || '';
      s.per = s.per || {}; s.per.auction = Object.assign({}, s.per.auction);
      if (acq.minProfit != null) s.per.auction.minProfit = acq.minProfit;
      if (acq.fees != null) s.per.auction.fees = acq.fees;
    }
    store.set(LS.settings, s);
    const h = store.get(LS.hist, []);
    const have = new Set(h.map((r) => r.id));
    for (const r of store.get('lccScan.history', [])) if (r && !have.has(r.id)) h.push(Object.assign(r, { mode: 'checkin' }));
    for (const r of store.get('lccAcq.history', [])) if (r && !have.has(r.id)) h.push(Object.assign(r, { mode: 'auction' }));
    h.sort((a, b) => new Date(b.at) - new Date(a.at));
    store.set(LS.hist, h);
    if (store.get(LS.port, null) == null) { const p = store.get('lccScan.lastTransport', null) || store.get('lccAcq.lastTransport', null); if (p) store.set(LS.port, p); }
    if (!store.get(LS.mode, null)) {
      if (ci && ci.token) store.set(LS.mode, 'checkin');
      else if (acq) store.set(LS.mode, 'auction');
    }
    store.set(LS.migrated, true);
  }
  migrate();
  if (TEST) {
    document.title = 'TEST ' + document.title;
    document.documentElement.classList.add('is-test');
    const b = document.createElement('div'); b.className = 'testbar'; b.setAttribute('role', 'note');
    b.textContent = 'TEST APP \u00b7 changes here aren\u2019t live yet';
    document.body.prepend(b);
  }

  let settings = Object.assign({ name: '', token: '', fill: true, per: {} }, store.get(LS.settings, {}));
  const urlMode = new URLSearchParams(location.search).get('mode');
  let modeId = MODES[urlMode] ? urlMode : (MODES[store.get(LS.mode, '')] ? store.get(LS.mode, '') : null);
  let M = MODES[modeId] || MODES.checkin;
  if (MODES[urlMode]) store.set(LS.mode, urlMode);

  function per(id) {
    const m = MODES[id || M.id] || M; const p = settings.per[m.id] || {};
    return { minProfit: p.minProfit != null ? +p.minProfit : (m.minProfit || 0), fees: p.fees != null ? +p.fees : (m.fees || 0), keepDays: +p.keepDays || m.keepDays || 30 };
  }

  let elm = null, transport = null, current = null, busy = false, match = null, sendMode = 'match', lastKind = 'serial';

  /* ---------- helpers ---------- */
  const show = (el, on = true) => { if (el) el.classList.toggle('hidden', !on); };
  const fmtMi = (n) => n == null ? '\u2014' : Math.round(n).toLocaleString() + ' mi';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const isBid = () => M.money === 'bid';
  const isMonday = () => M.destination === 'monday';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function setPill() {
    const p = $('connPill');
    p.className = 'pill' + (transport ? (transport.name === 'Demo' ? ' demo' : ' on') : '');
    p.textContent = transport ? (transport.name === 'Demo' ? 'Demo truck' : 'Connected') : 'Not connected';
    show($('disconnectBtn'), !!transport);
    show($('connectBtn'), !transport);
    $('scanBtn').disabled = !transport || busy;
    $('quickBtn').disabled = !transport || busy;
  }
  function err(box, msg) { box.textContent = msg; show(box, !!msg); }
  function renderFindings(ul, findings) {
    ul.textContent = '';
    for (const f of findings) {
      const li = document.createElement('li'); li.className = f.level;
      const d = document.createElement('div');
      const b = document.createElement('b'); b.textContent = f.title; d.appendChild(b);
      if (f.detail) { const s = document.createElement('span'); s.textContent = f.detail; d.appendChild(s); }
      if (f.code) d.appendChild(fixBlock(f.code));
      else if (f.moduleCode) d.appendChild(fixBlock(f.moduleCode, f.module));
      else if (f.parts && f.parts.length) d.appendChild(partsBlock(f.parts));
      li.appendChild(d); ul.appendChild(li);
    }
  }
  const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  function vehicleQuery(rec) {
    const d = rec && rec.decoded; return d ? [d.year, titleCase(d.make), d.model].filter(Boolean).join(' ') : '';
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; show(t); clearTimeout(toast.t); toast.t = setTimeout(() => show(t, false), 3500); }
  function shopLink(l) {
    const a = document.createElement('a'); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = l.name;
    if (l.copy) a.addEventListener('click', () => { try { navigator.clipboard.writeText(l.copy); toast(/^[A-HJ-NPR-Z0-9]{17}$/.test(l.copy) ? 'VIN copied. Paste it into AutoZone Pro\u2019s VIN lookup, then search \u201c' + l.part + '\u201d.' : 'Copied \u201c' + l.copy + '\u201d. Paste it into the AutoZone Pro search.'); } catch (e) {} });
    return a;
  }
  function partsRows(box, parts) {
    for (const part of parts) {
      const row = document.createElement('div'); row.className = 'parts';
      const n = document.createElement('span'); n.textContent = part; row.appendChild(n);
      for (const l of OBD.partLinks(part, vehicleQuery(current), current && current.vin)) row.appendChild(shopLink(l));
      box.appendChild(row);
    }
  }
  function fixBlock(code, moduleName) {
    const fx = moduleName ? OBD.moduleFix(moduleName) : OBD.fixFor(code);
    const box = document.createElement('div'); box.className = 'fix';
    const p = document.createElement('p'); p.textContent = 'Likely fix: ' + fx.fix; box.appendChild(p);
    if (fx.tierWord) { const t = document.createElement('p'); t.className = 'tier t' + fx.tier.length; t.textContent = fx.tier + '  ' + fx.tierWord; box.appendChild(t); }
    partsRows(box, fx.parts);
    return box;
  }
  function partsBlock(parts) { const box = document.createElement('div'); box.className = 'fix'; partsRows(box, parts); return box; }
  function partsHtml(parts, rec) {
    return '<br><i>Parts:</i> ' + parts.map((p) => esc(p) + ' (' + OBD.partLinks(p, vehicleQuery(rec), rec.vin).map((l) => '<a href="' + esc(l.url) + '">' + l.name + '</a>').join(' \u00b7 ') + ')').join('; ');
  }
  function makeOf(rec) {
    if (rec.decoded && rec.decoded.make) return rec.decoded.make;
    return /^(1F|2F|3F|NM0|MAJ|5LM|1LN|2LM|3LN)/.test(rec.vin || '') ? 'Ford' : '';
  }
  function codesOf(rec) { return rec.assessment.findings.filter((f) => f.code).map((f) => f.code); }
  function bigTicket(rec) {
    const c = codesOf(rec).filter((x) => OBD.fixFor(x).tier === '$$$');
    const idleBad = rec.idleAssessment && rec.idleAssessment.findings.some((f) => /Misfires on cylinder|Rough idle/.test(f.title) && f.level === 'problem');
    const total = estTotal(rec);
    return { codes: c, any: c.length > 0 || total > 1000, idleBad, total };
  }
  function renderVerdict(el, level, sub) {
    el.className = 'verdict ' + level;
    el.textContent = '';
    const k = document.createElement('span'); k.className = 'kpi'; k.textContent = LEVEL_WORD[level]; el.appendChild(k);
    if (sub) { const s = document.createElement('span'); s.textContent = sub; el.appendChild(s); }
  }

  /* ---------- modes ---------- */
  function applyMode() {
    document.body.dataset.mode = M.id;
    $('modeTitle').textContent = M.title;
    document.title = M.title + ' \u00b7 Vehicle Scan';
    document.querySelectorAll('[data-modes]').forEach((el) => show(el, el.dataset.modes.split(/\s+/).includes(M.id)));
    document.querySelectorAll('[data-money]').forEach((el) => show(el, el.dataset.money === M.money));
    document.querySelectorAll('[data-dest]').forEach((el) => show(el, el.dataset.dest === M.destination));
    document.querySelectorAll('[data-quick]').forEach((el) => show(el, !!M.quick));
    $('stockLabel').textContent = M.stockLabel;
    $('stock').placeholder = M.stockPlaceholder;
    $('scanHint').textContent = M.scanHint;
    $('quickHint').textContent = 'Runs the scan, airbag/ABS/transmission check and, if it\u2019s running, a 15-second idle check, then gives you the call. Do the ' + M.driveName.toLowerCase() + ' after.';
    $('scanBtn').textContent = M.quick ? 'Scan only' : 'Scan truck';
    $('scanBtn').className = 'btn block' + (M.quick ? '' : ' dark');
    $('driveTitle').textContent = M.driveName;
    $('driveIntro').innerHTML = M.driveIntro;
    $('driveBtn').textContent = 'Start ' + M.driveName.toLowerCase();
    $('driveEnd').textContent = 'End ' + M.driveName.toLowerCase();
    $('sendTitle').textContent = isMonday() ? 'Estimate & send' : (isBid() ? M.resultName + ' & save' : 'Estimate & save');
    $('estHint').textContent = M.estimateHint;
    $('estName').textContent = M.estimateName;
    if (isBid()) {
      $('bidTitle').textContent = M.resultName;
      $('callBidLabel').textContent = M.resultName;
      $('priceLabel').textContent = M.priceLabel;
      $('salePrice').placeholder = M.pricePlaceholder || '';
      $('priceHint').innerHTML = M.priceHint;
      $('profitLabel').textContent = M.id === 'trade' ? 'Gross wanted on a trade' : 'Minimum profit after recon';
      $('feesLabel').textContent = M.feesName + ' per vehicle';
      $('mathNote').textContent = M.resultName + ' = ' + M.priceLabel.toLowerCase() + ' \u2212 ' + M.estimateName.toLowerCase() + ' \u2212 ' + $('profitLabel').textContent.toLowerCase() + ' \u2212 ' + M.feesName.toLowerCase() + '.';
    }
    show($('scoutBtn'), !!M.scout); show($('scoutCallBtn'), !!M.scout);
    $('phoneNote').textContent = 'Every ' + M.record + ' is saved on this phone under Recent ' + M.records + '. Nothing is sent anywhere unless you share it.';
    $('histTitle').textContent = 'Recent ' + M.records;
    $('keepLabel').textContent = 'Keep ' + M.records + ' on this phone';
    $('clearHist').textContent = 'Clear saved ' + M.records;
    updateSetup(); renderHist();
  }
  function setMode(id) {
    if (!MODES[id]) return;
    if (busy) { toast('Finish the current check first.'); return; }
    if (current && current.mode !== id) clearScreen();
    modeId = id; M = MODES[id]; store.set(LS.mode, id);
    if (MODES[new URLSearchParams(location.search).get('mode')]) history.replaceState(null, '', location.pathname + location.hash);
    applyMode();
  }
  function openModes() {
    const box = $('modeList'); box.textContent = '';
    for (const id of MODE_ORDER) {
      const m = MODES[id];
      const b = document.createElement('button'); b.value = id; if (id === modeId) b.className = 'on';
      const t = document.createElement('b'); t.textContent = m.label;
      const s = document.createElement('span'); s.textContent = m.blurb;
      const w = document.createElement('small'); w.textContent = 'Owner: ' + m.who;
      b.append(t, s, w); box.appendChild(b);
    }
    $('modeDlg').showModal();
  }

  /* ---------- connecting ---------- */
  function supportMsg() {
    if (!('serial' in navigator) && !('bluetooth' in navigator)) return 'This browser can\u2019t reach Bluetooth scanners. Open this page in Chrome on an Android phone (Chrome 138 or newer). The demo truck still works here.';
    return '';
  }
  /* Connection log: every step and every scanner message, so a failed connect can be copied and sent */
  const clog = [];
  function connLog(msg) {
    const ts = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    clog.push(ts + '  ' + msg); if (clog.length > 400) clog.shift();
    const el = $('connLog'); if (el) { el.textContent = clog.join('\n'); el.scrollTop = el.scrollHeight; }
  }
  /* The Veepeak is classic Bluetooth: one app at a time. Another scan app with auto-connect on grabs it first. */
  function explain(e) {
    const n = (e && e.name) || '', m = (e && e.message) || '';
    if (m === 'NO_ADAPTER') return 'The phone opened a Bluetooth link but the Veepeak didn\u2019t reply. Another scan app is probably holding it. See \u201cScanner won\u2019t connect?\u201d below.';
    if (n === 'NetworkError' || /failed to open|connection|rfcomm|socket/i.test(m)) return 'Couldn\u2019t open a link to the Veepeak. Most often another scan app (Car Scanner, Torque, OBD Fusion) is holding it, even in the background. See \u201cScanner won\u2019t connect?\u201d below. Also check the key is ON and the Veepeak light is on.';
    if (n === 'SecurityError') return 'Chrome isn\u2019t allowed to use Bluetooth. Android Settings \u2192 Apps \u2192 Chrome \u2192 Permissions \u2192 Nearby devices \u2192 Allow.';
    return m || 'Couldn\u2019t connect.';
  }
  async function connect(kind) {
    err($('connectErr'), '');
    lastKind = kind;
    let t;
    try {
      if (transport) await disconnect();
      connLog('--- Connect (' + kind + ', ' + M.id + ' mode) \u00b7 ' + navigator.userAgent.replace(/^.*?\(/, '(').slice(0, 140));
      if (kind === 'demo') { t = new OBD.DemoTransport(); OBD.DEMO_TRUCK.demoRunning = false; }
      else if (kind === 'ble') {
        if (!OBD.BleTransport.supported()) throw new Error('Bluetooth LE isn\u2019t available in this browser.');
        t = await OBD.BleTransport.pick();
      } else {
        if (!OBD.SerialTransport.supported()) {
          throw new Error(OBD.BleTransport.supported()
            ? 'This Chrome can\u2019t reach classic Bluetooth scanners yet. Update Chrome (138 or newer), or use a Bluetooth LE scanner.'
            : supportMsg());
        }
        if (kind !== 'choose') connLog('Previously picked scanners: ' + (await navigator.serial.getPorts()).length);
        t = kind === 'choose' ? await OBD.SerialTransport.choose() : await OBD.SerialTransport.pick();
        t.log = connLog;
        connLog('Scanner chosen: ' + t.info());
      }
      $('connectMsg').textContent = 'Connecting\u2026';
      await t.open();
      const e2 = new OBD.Elm(t); e2.onLog = connLog;
      if (kind !== 'demo') {
        $('connectMsg').textContent = 'Linked. Checking the Veepeak answers\u2026';
        const id = await e2.hello();
        connLog('Adapter answered: ' + id);
      }
      transport = t; elm = e2;
      if (t.port) t.port.addEventListener('disconnect', () => { connLog('Android reported the scanner disconnected'); lost(); });
      if (t.device) t.device.addEventListener('gattserverdisconnected', () => { connLog('Bluetooth LE scanner disconnected'); lost(); });
      store.set(LS.port, kind);
      connLog('Connected');
      $('helpBox').open = false;
      $('connectMsg').textContent = kind === 'demo'
        ? 'Demo truck connected. Practice ' + M.records + ' are marked (demo)' + (isMonday() ? ' and never post to monday.com.' : '.')
        : 'Scanner connected. ' + (M.quick ? 'Tap Quick appraisal.' : 'Tap Scan truck.');
      setPill(); updateSetup();
    } catch (e) {
      connLog('Failed: ' + ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e));
      if (t && t.close && !transport) { try { await t.close(); } catch (x) {} }
      if (e && e.name === 'NotFoundError') { $('connectMsg').textContent = 'No scanner picked. If the Veepeak isn\u2019t in the list, pair it in Android Bluetooth settings first.'; return; }
      $('connectMsg').textContent = 'Plug the scanner in, turn the key to ON (or start the truck), then connect. If it keeps failing, tap Pick a different scanner and choose OBDII.';
      err($('connectErr'), explain(e));
      $('helpBox').open = true;
    }
  }
  async function disconnect() {
    const t = transport; transport = null; elm = null; setPill();
    if (t) try { await t.close(); } catch (e) {}
    $('connectMsg').textContent = 'Disconnected.';
  }
  function lost() {
    if (!transport) return;
    transport = null; elm = null; setPill();
    $('connectMsg').textContent = 'Lost the scanner. Check it\u2019s still plugged in, then tap Connect.';
  }

  /* ---------- scan ---------- */
  function buildAssessment(r, miles) {
    const a = OBD.assess(r, miles);
    if (r.freeze) a.findings.forEach((f) => { if (f.code === r.freeze.code) f.detail += ' ' + OBD.describeFreeze(r.freeze); });
    if (r.modules) {
      a.findings.push(...OBD.assessModules(r.modules));
      const order = { problem: 0, watch: 1, good: 2, info: 3 };
      a.findings.sort((x, y) => order[x.level] - order[y.level]);
      a.overall = a.findings.some((f) => f.level === 'problem') ? 'problem' : a.findings.some((f) => f.level === 'watch') ? 'watch' : 'good';
    }
    return a;
  }
  const STEPS = ['Waking up the adapter', 'Finding the truck\u2019s computer', 'Checking what this truck reports', 'Reading the VIN',
    'Reading check engine light and monitors', 'Reading trouble codes', 'Reading battery and engine data'];
  let lastStep = 0;
  function progress(step) {
    let i = STEPS.indexOf(step); if (i < 0) i = Math.min(lastStep + 0.3, STEPS.length - 0.2); lastStep = i;
    $('scanStep').textContent = step + '\u2026';
    $('scanBar').style.width = Math.round(((i + 1) / (STEPS.length + 1)) * 100) + '%';
  }

  async function scan() {
    if (!elm || busy) return;
    busy = true; setPill(); err($('scanErr'), ''); show($('autoNote'), false);
    show($('scanProgress')); ['callCard', 'resultCard', 'idleCard', 'sendCard', 'driveCard', 'idleResult', 'idleLive'].forEach((id) => show($(id), false));
    $('sendMsg').classList.add('hidden');
    try {
      if (transport.name === 'Demo') OBD.DEMO_TRUCK.demoRunning = false;
      await elm.init(progress);
      const r = await OBD.runScan(elm, progress);
      if ((r.stored || []).length || (r.status && r.status.mil)) { progress('Reading freeze frame'); r.freeze = await OBD.freezeFrame(elm); }
      if ($('doModules').checked) r.modules = await OBD.moduleScan(elm, makeOf({ vin: r.vin }), progress);
      $('scanBar').style.width = '100%'; $('scanStep').textContent = 'Done.';
      // Dash miles typed in win; otherwise use what the truck's computer reports
      const typed = +$('miles').value || null;
      const miles = typed || (r.odometerMi ? Math.round(r.odometerMi) : null);
      const a = buildAssessment(r, typed);
      const typedStock = $('stock').value.trim().toUpperCase();
      current = {
        id: Date.now().toString(36), at: r.at, mode: M.id, demo: transport.name === 'Demo', tech: settings.name || '',
        vin: r.vin, stock: typedStock || (M.stockFromVin ? OBD.stockFromVin(r.vin) || '' : ''), miles,
        scan: r, assessment: a, idle: null, idleAssessment: null, decoded: null, sent: null
      };
      if (!typedStock && current.stock) $('stock').value = current.stock;
      if (!typed && miles) $('miles').value = miles;
      current.milesSource = typed ? 'dash' : (miles ? 'truck' : null);
      $('autoNote').textContent = [
        r.vin ? 'VIN ' + r.vin + ' read from the vehicle.' : (M.stockFromVin ? 'Couldn\u2019t read the VIN from this truck. Type the Stock # (last 6 of the VIN).' : 'Couldn\u2019t read the VIN from this vehicle. Note it from the dash or door jamb.'),
        typed ? '' : (miles ? 'Miles read from the truck\u2019s computer. Glance at the dash; if it\u2019s different, type the dash number.' : 'This truck doesn\u2019t report mileage. Type it from the dash.')
      ].join(' ');
      show($('autoNote'));
      renderScan();
      saveHist();
      decodeVin(current);
      show($('idleCard'));
      prepIdle();
      show($('driveCard')); show($('driveResult'), false); show($('driveLive'), false);
      show($('sendCard'));
      current.estimate = { lines: [], removed: [] };
      renderEstimate();
      $('notes').value = ''; $('salePrice').value = ''; $('payoff').value = '';
      if (isBid()) { renderBid(); renderCall(); }
      if (isMonday()) lookupMatch();
      return true;
    } catch (e) {
      const msg = e && e.message === 'NO_ECU'
        ? 'The scanner is connected but the truck didn\u2019t answer. Turn the key to ON or start the truck, wait 5 seconds, and tap Scan again.'
        : /timeout/.test((e && e.message) || '')
          ? 'The scanner stopped answering. Unplug it for 5 seconds, plug it back in, reconnect, and scan again.'
          : 'Scan stopped: ' + ((e && e.message) || 'unknown error');
      err($('scanErr'), msg);
    } finally {
      busy = false; setPill();
      setTimeout(() => show($('scanProgress'), false), 800);
    }
  }

  function renderScan() {
    const r = current.scan, a = current.assessment;
    const codes = (r.stored || []).length + (r.pending || []).length;
    renderVerdict($('verdict'), a.overall, codes ? codes + ' trouble code' + (codes > 1 ? 's' : '') + ' found' : 'No trouble codes stored');
    renderFindings($('findings'), a.findings);
    const dl = $('readings'); dl.textContent = '';
    const add = (k, v, wide) => { if (v == null || v === '') return; const d = document.createElement('div'); if (wide) d.className = 'wide';
      const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; d.append(dt, dd); dl.appendChild(d); };
    add('VIN', r.vin || 'Not readable', true);
    if (current.decoded) add('Vehicle', current.decoded.label, true);
    add(M.stockLabel, current.stock || '\u2014');
    add('Battery', r.voltage != null ? r.voltage.toFixed(1) + ' V' : null);
    add('Engine', r.engineRunning == null ? null : r.engineRunning ? 'Running, ' + Math.round(r.rpm) + ' RPM' : 'Off (key on)');
    add('Coolant', r.coolantF != null ? r.coolantF + '\u00b0F' : null);
    add('Since codes cleared', r.distSinceClearMi != null ? fmtMi(r.distSinceClearMi) + (r.warmupsSinceClear != null ? ', ' + r.warmupsSinceClear + ' warm-ups' : '') : null, true);
    add('Driven with light on', r.milDistanceMi ? fmtMi(r.milDistanceMi) : null);
    add('Computer odometer', r.odometerMi ? fmtMi(r.odometerMi) : null);
    add('Fuel level', r.fuelPct != null ? r.fuelPct + '%' : null);
    const mons = r.status ? r.status.monitors : [];
    show($('monWrap'), mons.length > 0);
    const mw = $('mons'); mw.textContent = '';
    mons.forEach((m) => { const s = document.createElement('span'); s.className = m.complete ? 'done' : 'not'; s.textContent = (m.complete ? '\u2713 ' : '\u2022 ') + m.name; mw.appendChild(s); });
    const extra = $('extraNotes'); extra.textContent = '';
    const bt = bigTicket(current);
    if (bt.any) {
      const n = document.createElement('div'); n.className = 'notice err';
      n.textContent = 'Likely over $1,000' + (bt.codes.length ? ' (' + bt.codes.join(', ') + ')' : '') + '. ' + M.overThousand.replace(/^Over \$1,000[^.]*\.\s*/, '');
      extra.appendChild(n);
    }
    if (current.vin) {
      const n = document.createElement('div'); n.className = 'notice';
      const a2 = document.createElement('a'); a2.href = 'https://www.nhtsa.gov/recalls?vin=' + current.vin; a2.target = '_blank'; a2.rel = 'noopener'; a2.textContent = 'Check this VIN for open recalls';
      const t = document.createElement('span');
      t.textContent = current.recalls ? current.recalls.count + ' recall' + (current.recalls.count === 1 ? '' : 's') + ' on file for this year/model. ' : '';
      n.append(t, a2); extra.appendChild(n);
    }
    show($('resultCard'));
    $('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function decodeVin(rec) {
    if (!rec.vin || rec.vin.length !== 17 || !navigator.onLine) return false;
    try {
      const res = await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + rec.vin + '?format=json');
      const j = await res.json(); const v = j.Results && j.Results[0];
      if (!v || !v.ModelYear) return;
      const eng = [v.DisplacementL ? (+v.DisplacementL).toFixed(1) + 'L' : '', v.EngineCylinders ? 'V' + v.EngineCylinders : '', /diesel/i.test(v.FuelTypePrimary || '') ? 'diesel' : ''].filter(Boolean).join(' ');
      rec.decoded = { year: v.ModelYear, make: v.Make, model: v.Model, trim: v.Trim || v.Series || '', engine: eng, drive: v.DriveType || '',
        label: [v.ModelYear, titleCase(v.Make), v.Model, v.Trim].filter(Boolean).join(' ') + (eng ? ' \u00b7 ' + eng : '') };
      if (rec === current) { renderScan(); renderEstimate(); suggestName(); if (isBid()) { renderBid(); renderCall(); } }
      updateHist(rec);
      try {
        const rr = await fetch('https://api.nhtsa.gov/recalls/recallsByVehicle?make=' + encodeURIComponent(v.Make) + '&model=' + encodeURIComponent(v.Model) + '&modelYear=' + v.ModelYear);
        const rj = await rr.json();
        rec.recalls = { count: (rj.results || rj.Results || []).length, items: (rj.results || rj.Results || []).slice(0, 8).map((x) => ({ id: x.NHTSACampaignNumber, part: x.Component })) };
        if (rec === current) renderScan();
        updateHist(rec);
      } catch (e) {}
    } catch (e) { /* offline or NHTSA down: retried when signal comes back */ }
  }

  /* ---------- battery, idle ---------- */
  function after() { renderEstimate(); if (isBid()) { renderBid(); renderCall(); } saveHist(); }
  async function runCrank() {
    if (!elm || busy || !current) return;
    busy = true; setPill(); $('crankBtn').disabled = true;
    show($('crankLive')); show($('crankFindings'), false);
    if (current.demo) { OBD.DEMO_TRUCK.demoRunning = false; OBD.DEMO_TRUCK.crankAt = Date.now(); }
    try {
      const r = await OBD.crankTest(elm, { seconds: 12, onSample: (v, frac) => {
        $('voltNow').textContent = v.toFixed(1); $('crankBar').style.width = Math.min(100, frac * 100) + '%';
        $('crankCue').textContent = frac < 0.45 ? 'Start the truck now' : 'Keep it running';
      } });
      const a = OBD.assessCrank(r);
      current.crank = r; current.crankAssessment = a;
      renderFindings($('crankFindings'), a.findings); show($('crankFindings'));
      current.scan.engineRunning = a.last > 13 || current.scan.engineRunning;
      prepIdle(); after();
    } finally {
      if (current.demo) OBD.DEMO_TRUCK.crankAt = 0;
      busy = false; setPill(); $('crankBtn').disabled = false; $('crankCue').textContent = '';
    }
  }
  function prepIdle() {
    const running = current.scan.engineRunning, demo = current.demo;
    show($('crankBox'), !current.crankAssessment ? !running : true);
    if (!current.crankAssessment) { show($('crankLive'), false); show($('crankFindings'), false); }
    $('idleIntro').textContent = running || demo
      ? 'Truck warmed up, in park, A/C and lights off. Takes 30 seconds; don\u2019t touch the gas.'
      : 'Start the engine and let it warm up, then run this. It watches the idle for 30 seconds and reads the engine\u2019s own misfire counters.';
    $('idleBtn').textContent = demo && !running ? 'Run idle check (demo starts the engine)' : 'Run 30-second idle check';
  }
  async function runIdle(seconds) {
    seconds = typeof seconds === 'number' ? seconds : 30;
    if (!elm || busy || !current) return;
    busy = true; setPill(); $('idleBtn').disabled = true;
    show($('idleLive')); show($('idleResult'), false);
    let wake = null; try { wake = await navigator.wakeLock.request('screen'); } catch (e) {}
    if (current.demo) OBD.DEMO_TRUCK.demoRunning = true;
    const pts = [];
    try {
      const r = await OBD.idleCheck(elm, {
        seconds, supported: current.scan.supported,
        onSample: (rpm, frac) => { pts.push(rpm); $('rpmNow').textContent = Math.round(rpm); $('idleBar').style.width = Math.min(100, frac * 100) + '%'; drawSpark(pts); }
      });
      $('idleBar').style.width = '100%';
      const a = OBD.assessIdle(r);
      current.idle = r; current.idleAssessment = a;
      renderVerdict($('idleVerdict'), a.overall, a.stats ? 'Average idle ' + a.stats.mean + ' RPM over ' + a.stats.samples + ' readings' : '');
      renderFindings($('idleFindings'), a.findings);
      show($('idleResult'));
      after();
    } catch (e) {
      err($('scanErr'), 'Idle check stopped: ' + ((e && e.message) || 'unknown error'));
    } finally {
      if (wake) try { wake.release(); } catch (e) {}
      busy = false; setPill(); $('idleBtn').disabled = false;
    }
  }
  function drawSpark(pts) {
    const c = $('spark'), g = c.getContext('2d');
    const W = c.width, H = c.height, pad = 16;
    g.clearRect(0, 0, W, H);
    if (pts.length < 2) return;
    const lo = Math.min(...pts) - 20, hi = Math.max(...pts) + 20;
    const css = getComputedStyle(document.documentElement);
    g.strokeStyle = css.getPropertyValue('--muted').trim() || '#666'; g.lineWidth = 1; g.setLineDash([6, 6]);
    const mean = pts.reduce((a, b) => a + b, 0) / pts.length;
    const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
    g.beginPath(); g.moveTo(0, y(mean)); g.lineTo(W, y(mean)); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#FF8C00'; g.lineWidth = 4; g.lineJoin = 'round'; g.beginPath();
    pts.forEach((v, i) => { const x = (i / Math.max(pts.length - 1, 1)) * W; i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
    g.stroke();
  }

  /* ---------- drive ---------- */
  let driveAbort = null;
  async function startDrive() {
    if (!elm || busy || !current) return;
    busy = true; setPill(); show($('driveBtn'), false); show($('driveLive')); show($('driveResult'), false);
    let wake = null; try { wake = await navigator.wakeLock.request('screen'); } catch (e) {}
    if (current.demo) { OBD.DEMO_TRUCK.demoRunning = true; OBD.DEMO_TRUCK.driveAt = Date.now(); }
    driveAbort = new AbortController();
    const t0 = Date.now(); let miles = 0, last = null;
    try {
      const r = await OBD.driveLog(elm, { signal: driveAbort.signal, supported: current.scan.supported, onSample: (smp) => {
        if (smp.mph != null) $('mphNow').textContent = Math.round(smp.mph);
        if (smp.rpm != null) $('driveRpm').textContent = Math.round(smp.rpm);
        if (last && smp.mph != null && last.mph != null) miles += ((smp.mph + last.mph) / 2) * ((smp.t - last.t) / 3600000);
        if (smp.mph != null) last = smp;
        $('driveSoFar').textContent = Math.floor((Date.now() - t0) / 60000) + ' min \u00b7 ' + miles.toFixed(1) + ' mi';
      } });
      if (current.demo) OBD.DEMO_TRUCK.driveAt = 0;
      $('driveSoFar').textContent = 'Checking for new codes\u2026';
      const aft = await OBD.afterDrive(elm);
      const a = OBD.assessDrive(r, { stored: current.scan.stored, pending: current.scan.pending }, aft, { lane: !!M.lane });
      current.drive = { start: r.start, end: r.end, stats: a.stats, lane: !!M.lane }; current.driveAssessment = a;
      renderVerdict($('driveVerdict'), a.overall, a.stats ? a.stats.minutes + ' min, ' + a.stats.miles + ' mi, top ' + a.stats.maxMph + ' mph' : '');
      renderFindings($('driveFindings'), a.findings); show($('driveResult'));
      after();
    } catch (e) {
      err($('scanErr'), M.driveName + ' stopped: ' + ((e && e.message) || 'unknown error'));
    } finally {
      if (wake) try { wake.release(); } catch (e) {}
      busy = false; setPill(); show($('driveLive'), false); show($('driveBtn')); $('driveBtn').textContent = 'Record another ' + M.driveName.toLowerCase();
    }
  }

  /* ---------- estimate / recon cost ---------- */
  const mid = (r) => Math.round(((r[0] + r[1]) / 2) / 10) * 10;
  function suggestedLines(rec) {
    const L = []; const add = (id, label, range, sub) => { if (range && range[1] > 0 && !L.some((x) => x.id === id)) L.push({ id, label, sub: sub || '', range, amount: mid(range) }); };
    const a = rec.assessment;
    const codes = new Set();
    for (const f of a.findings) {
      if (f.code && f.level !== 'good') { const fx = OBD.fixFor(f.code); codes.add(f.code); add('code:' + f.code, f.code + ' ' + OBD.describeCode(f.code), fx.range, fx.parts.join(', ')); }
      if (f.moduleCode && f.level !== 'good') { const fx = OBD.moduleFix(f.module); add('mod:' + f.module + ':' + f.moduleCode, f.module + ' ' + f.moduleCode, fx.range, fx.parts.join(', ')); }
    }
    const misfireCode = [...codes].some((c) => /^P03/.test(c));
    if (rec.crankAssessment && rec.crankAssessment.findings.some((f) => /battery/i.test(f.title) && f.level !== 'good')) add('battery', 'Battery', [180, 300], 'battery');
    else if (a.findings.some((f) => /^Battery low/.test(f.title))) add('battery', 'Battery', [180, 300], 'battery');
    if (rec.idleAssessment) for (const f of rec.idleAssessment.findings) {
      if (f.level === 'good' || f.level === 'info') continue;
      if (/Misfire|Rough|unsteady/i.test(f.title) && !misfireCode) add('tuneup', 'Tune-up: plugs and coils', [250, 700], 'spark plugs, ignition coil');
      if (/lean/i.test(f.title) && !codes.has('P0171') && !codes.has('P0174')) add('vacuum', 'Vacuum leak / MAF cleaning', [50, 300]);
    }
    if (rec.driveAssessment) for (const f of rec.driveAssessment.findings) {
      if (f.level !== 'problem') continue;
      if (/flared/i.test(f.title)) add('trans', 'Transmission: shop diagnosis/repair', [300, 4500], 'get a transmission shop quote');
      if (/wavering/i.test(f.title)) add('tcc', 'Torque converter shudder', [300, 3000], 'fluid service first');
      if (/Ran hot/i.test(f.title)) add('cooling', 'Cooling system', [200, 800], 'thermostat, coolant');
      if (f.code && !codes.has(f.code)) { const fx = OBD.fixFor(f.code); add('code:' + f.code, f.code + ' ' + OBD.describeCode(f.code), fx.range, fx.parts.join(', ')); }
    }
    return L;
  }
  function renderEstimate() {
    if (!current) return;
    const est = current.estimate || (current.estimate = { lines: [], removed: [] });
    const keep = new Map(est.lines.map((l) => [l.id, l]));
    const lines = [];
    for (const l of suggestedLines(current)) { if (est.removed.includes(l.id)) continue; lines.push(keep.has(l.id) ? keep.get(l.id) : l); keep.delete(l.id); }
    for (const l of keep.values()) if (l.manual) lines.push(l);
    est.lines = lines;
    const ul = $('estLines'); ul.textContent = '';
    for (const l of lines) {
      const li = document.createElement('li');
      const lab = document.createElement('span'); lab.textContent = l.label;
      const sm = document.createElement('small'); sm.textContent = l.manual ? 'Added by hand' : 'Typical $' + l.range[0].toLocaleString() + '\u2013$' + l.range[1].toLocaleString() + (l.sub ? ' \u00b7 ' + l.sub : ''); lab.appendChild(sm);
      const inp = document.createElement('input'); inp.type = 'number'; inp.inputMode = 'numeric'; inp.value = l.amount; inp.setAttribute('aria-label', 'Amount for ' + l.label);
      inp.oninput = () => { l.amount = Math.max(0, +inp.value || 0); totals(); };
      inp.onchange = () => saveHist();
      const x = document.createElement('button'); x.textContent = '\u00d7'; x.setAttribute('aria-label', 'Remove ' + l.label);
      x.onclick = () => { if (!l.manual) est.removed.push(l.id); est.lines = est.lines.filter((y) => y !== l); renderEstimate(); saveHist(); };
      li.append(lab, inp, x); ul.appendChild(li);
    }
    totals();
  }
  function estTotal(rec) { return ((rec && rec.estimate && rec.estimate.lines) || []).reduce((s, l) => s + (+l.amount || 0), 0); }
  function totals() {
    $('estTotal').textContent = '$' + estTotal(current).toLocaleString();
    const over = bigTicket(current).any;
    $('estWarn').textContent = over ? M.overThousand : '';
    show($('estWarn'), over);
    if (isBid()) { renderBid(); renderCall(); }
  }
  function addLine() {
    const d = $('estNewDesc').value.trim(), amt = +$('estNewAmt').value || 0;
    if (!d || !current) return;
    current.estimate.lines.push({ id: 'm' + Date.now(), label: d, amount: amt, manual: true, range: [0, 0] });
    $('estNewDesc').value = ''; $('estNewAmt').value = '';
    renderEstimate(); saveHist();
  }

  /* ---------- red flags, the call, max bid / trade offer (Auction and Trade) ---------- */
  function modeOf(rec) { return MODES[rec && rec.mode] || M; }
  function redFlags(rec) {
    const F = []; const add = (sev, title, detail) => F.push({ sev, title, detail: detail || '' });
    const s = rec.scan || {}, st = s.status;
    const recent = (s.distSinceClearMi != null && s.distSinceClearMi < 60) || (s.warmupsSinceClear != null && s.warmupsSinceClear < 5);
    const notReady = st ? st.monitors.filter((m) => !m.complete) : [];
    if (recent) add(notReady.length >= 2 ? 'hard' : 'soft', 'Codes cleared recently',
      [s.distSinceClearMi != null ? s.distSinceClearMi + ' mi' : '', s.warmupsSinceClear != null ? s.warmupsSinceClear + ' warm-ups' : ''].filter(Boolean).join(', ') + ' since the last reset. Problems may be hidden.');
    if (notReady.length >= 2) add('soft', notReady.length + ' self-tests not finished', notReady.map((m) => m.name).join(', '));
    const dash = rec.milesSource === 'dash' ? rec.miles : null;
    if (dash && s.odometerMi && Math.abs(s.odometerMi - dash) > 1000) add('hard', 'Odometer mismatch', 'Computer says ' + Math.round(s.odometerMi).toLocaleString() + ' mi, dash ' + (+dash).toLocaleString() + ' mi.');
    if (rec.vin && s.vinValid === false) add('soft', 'VIN doesn\u2019t check out', 'Compare the computer VIN to the dash plate and door jamb.');
    if (st && st.mil) add('soft', 'Check engine light is on', '');
    const codes = [...new Set([...(s.stored || []), ...(s.pending || []), ...(s.permanent || [])])];
    const trans = codes.filter((c) => /^P0(7|8)/.test(c));
    if (trans.length) add('hard', 'Transmission code' + (trans.length > 1 ? 's' : ''), trans.join(', '));
    const mods = (s.modules && s.modules.modules) || [];
    mods.forEach((m) => {
      if (!m.codes.length) return;
      if (/Airbag/.test(m.name)) add('hard', 'Airbag fault', m.codes.map((c) => c.code).join(', ') + '. Must be fixed before sale.');
      else if (/Transmission/.test(m.name) && m.codes.some((c) => c.active)) add('hard', 'Transmission module fault', m.codes.map((c) => c.code).join(', '));
      else if (/ABS|steering|4x4/i.test(m.name) && m.codes.some((c) => c.active)) add('soft', m.name + ' fault', m.codes.map((c) => c.code).join(', '));
    });
    const big = codes.filter((c) => OBD.fixFor(c).tier === '$$$' && !/^P0(7|8)/.test(c));
    if (big.length) add('soft', 'Big-ticket code' + (big.length > 1 ? 's' : ''), big.map((c) => c + ' ' + OBD.describeCode(c)).join('; '));
    const ia = rec.idleAssessment;
    if (ia) ia.findings.forEach((f) => { if (f.level === 'problem' && /Misfire|Rough|lean|rich/i.test(f.title)) add('soft', f.title, ''); });
    const da = rec.driveAssessment;
    if (da) da.findings.forEach((f) => { if (f.level === 'problem') add(/flared|wavering/i.test(f.title) ? 'hard' : 'soft', f.title, ''); });
    if (rec.crankAssessment) rec.crankAssessment.findings.forEach((f) => { if (f.level === 'problem') add('soft', f.title, ''); });
    F.sort((a, b) => (a.sev === 'hard' ? 0 : 1) - (b.sev === 'hard' ? 0 : 1));
    return F;
  }
  function maxBid(rec) {
    const sale = +rec.salePrice || 0;
    if (!sale) return null;
    const p = per(modeOf(rec).id);
    const recon = estTotal(rec), profit = p.minProfit, fees = p.fees;
    const bid = sale - recon - profit - fees;
    const payoff = +rec.payoff || 0;
    return { sale, recon, profit, fees, bid, payoff, equity: payoff ? bid - payoff : null };
  }
  function theCall(rec) {
    const m = modeOf(rec), words = m.calls || { good: 'Bid', watch: 'Caution', problem: 'Walk away' };
    const flags = redFlags(rec), hard = flags.filter((f) => f.sev === 'hard'), soft = flags.filter((f) => f.sev === 'soft');
    const mb = maxBid(rec), recon = estTotal(rec);
    let level = 'good', why = 'Nothing serious found.';
    if (hard.length) { level = 'problem'; why = hard.map((f) => f.title).join(', ') + '.'; }
    else if (mb && mb.bid <= 0) { level = 'problem'; why = 'Recon and profit eat the whole expected sale price.'; }
    else if (soft.length || recon > 1000) { level = 'watch'; why = (soft.length ? soft.map((f) => f.title).join(', ') + '. ' : '') + (recon > 1000 ? 'About ' + money(recon) + ' in likely recon.' : ''); }
    const checked = ['scan'];
    if (rec.idleAssessment) checked.push('idle'); if (rec.driveAssessment) checked.push(m.driveName.toLowerCase()); if (rec.crankAssessment) checked.push('battery');
    return { level, word: words[level], why: why.trim(), flags, mb, checked, driveDone: !!rec.driveAssessment, m };
  }
  function renderCall() {
    if (!current || !isBid()) return;
    const c = theCall(current); current.call = { word: c.word, level: c.level, bid: c.mb ? c.mb.bid : null };
    $('callCard').className = 'card callcard ' + c.level;
    const w = $('callWord'); w.className = 'word ' + c.level; w.textContent = c.word;
    $('callWho').textContent = [current.decoded ? current.decoded.label : (current.vin || ''), current.stock ? M.stockShort + ' ' + current.stock : ''].filter(Boolean).join(' \u00b7 ');
    $('callWhy').textContent = c.why + ' Checked: ' + c.checked.join(', ') + (c.driveDone ? '.' : '. ' + M.driveName + ' not done yet.') + (c.level === 'problem' && M.problemNote ? ' ' + M.problemNote : '');
    const ul = $('flags'); ul.textContent = '';
    for (const f of c.flags) { const li = document.createElement('li'); li.className = f.sev; li.textContent = f.title; if (f.detail) { const sp = document.createElement('span'); sp.textContent = f.detail; li.appendChild(sp); } ul.appendChild(li); }
    show($('callBid'), !!c.mb);
    show($('scoutCallBtn'), !!M.scout && !c.mb);
    if (c.mb) $('callBidAmt').textContent = c.mb.bid > 0 ? money(c.mb.bid) : 'None';
    const eq = c.mb && c.mb.equity != null;
    show($('callEquity'), eq);
    if (eq) $('callEquity').textContent = 'Payoff ' + money(c.mb.payoff) + (c.mb.equity >= 0 ? ' \u00b7 customer equity ' + money(c.mb.equity) : ' \u00b7 customer is ' + money(-c.mb.equity) + ' upside down');
    show($('callCard'));
  }
  function renderBid() {
    if (!current || !isBid()) return;
    const el = $('bidMath'); el.textContent = '';
    const mb = maxBid(current);
    const row = (k, v, cls) => { const a = document.createElement('span'); a.textContent = k; const b = document.createElement('span'); b.textContent = v; if (cls) { a.className = cls; b.className = cls; } el.append(a, b); };
    if (!mb) { row('Enter the ' + M.priceLabel.toLowerCase() + ' to get the ' + M.resultName.toLowerCase() + '.', ''); return; }
    row(M.priceLabel, money(mb.sale));
    row(M.estimateName + ' (this vehicle)', '\u2212 ' + money(mb.recon));
    row(M.id === 'trade' ? 'Gross wanted' : 'Minimum profit', '\u2212 ' + money(mb.profit));
    if (mb.fees) row(M.feesName, '\u2212 ' + money(mb.fees));
    row(M.resultName, mb.bid > 0 ? money(mb.bid) : 'None', 'tot');
    if (mb.equity != null) { row('Payoff', '\u2212 ' + money(mb.payoff)); row(mb.equity >= 0 ? 'Customer equity' : 'Upside down', money(Math.abs(mb.equity)), 'tot'); }
  }
  let awaitingScout = false;
  function lookupScout() {
    if (current) { current.notes = $('notes').value.trim(); updateHist(current); }
    const vin = current && current.vin;
    if (vin) { try { navigator.clipboard.writeText(vin); } catch (e) {} }
    awaitingScout = !!current;
    show($('scoutHint'), !!current);
    window.open(SCOUT_URL, '_blank', 'noopener');
  }
  // Back from SCOUT: put the cursor where the number goes
  function backFromScout() {
    if (document.visibilityState !== 'visible' || !awaitingScout || !current) return;
    awaitingScout = false;
    show($('sendCard'));
    $('bidBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => { try { $('salePrice').focus(); } catch (e) {} }, 400);
    toast('Type SCOUT\u2019s expected sale price.');
  }
  // A link back from SCOUT can carry the number: ...#vin=1FT...&sale=24500
  function takeFromLink() {
    const q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    const sale = +String(q.get('sale') || '').replace(/[^0-9.]/g, '');
    if (!sale) return;
    const vin = String(q.get('vin') || '').toUpperCase();
    let rec = current && (!vin || current.vin === vin) ? current : null;
    if (!rec) rec = store.get(LS.hist, []).find((r) => (r.mode || 'checkin') !== 'checkin' && (!vin || r.vin === vin)) || null;
    history.replaceState(null, '', location.pathname + location.search);
    if (!rec) { toast('Got a sale price from SCOUT, but no matching appraisal on this phone.'); return; }
    rec.salePrice = sale;
    if (rec.mode && rec.mode !== M.id) setMode(rec.mode);
    current = rec;
    updateHist(rec);
    if (current.scan) { $('salePrice').value = sale; renderBid(); renderCall(); show($('callCard')); }
    toast('Expected sale price ' + money(sale) + ' from SCOUT.');
  }

  /* ---------- quick appraisal and next vehicle ---------- */
  async function quick() {
    if (!elm || busy) return;
    $('doModules').checked = true;
    const ok = await scan();
    if (!ok || !current) return;
    if (current.scan.engineRunning || current.demo) {
      $('idleCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      await runIdle(15);
    }
    renderCall();
    $('callCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function keepFields() { if (current) { current.notes = $('notes').value.trim(); current.salePrice = +$('salePrice').value || current.salePrice || null; current.payoff = +$('payoff').value || null; saveHist(current); } }
  function clearScreen() {
    keepFields();
    current = null; match = null;
    ['callCard', 'resultCard', 'idleCard', 'driveCard', 'sendCard', 'autoNote', 'idleResult', 'idleLive', 'driveResult', 'driveLive', 'crankLive', 'crankFindings', 'scoutHint'].forEach((id) => show($(id), false));
    show($('driveBtn')); $('driveBtn').textContent = 'Start ' + M.driveName.toLowerCase();
    $('miles').value = ''; $('notes').value = ''; $('salePrice').value = ''; $('payoff').value = ''; $('sendMsg').classList.add('hidden'); awaitingScout = false;
    err($('scanErr'), '');
    if (transport && transport.name === 'Demo') { OBD.DEMO_TRUCK.demoRunning = false; OBD.DEMO_TRUCK.driveAt = 0; }
  }
  function nextVehicle() {
    if (busy) return;
    const lane = $('stock').value.trim();
    clearScreen();
    $('stock').value = M.nextBumpsNumber && /^\d+$/.test(lane) ? String(+lane + 1) : '';
    $('vehicleCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
    toast(transport ? 'Ready. Move the scanner to the next vehicle and tap ' + (M.quick ? 'Quick appraisal.' : 'Scan truck.') : 'Ready for the next vehicle.');
  }

  /* ---------- lookups that waited for signal ---------- */
  let retrying = false;
  async function retryPending() {
    if (retrying || !navigator.onLine) return;
    retrying = true;
    try {
      for (const rec of store.get(LS.hist, [])) {
        if (rec.vin && rec.vin.length === 17 && !rec.demo && (!rec.decoded || !rec.recalls)) await decodeVin(current && current.id === rec.id ? current : rec);
      }
    } finally { retrying = false; renderHist(); }
  }

  /* ---------- reports ---------- */
  const TAG = { problem: 'PROBLEM', watch: 'WATCH', good: 'OK', info: 'NOTE' };
  function fixHtml(code, rec, moduleName) {
    const fx = moduleName ? OBD.moduleFix(moduleName) : OBD.fixFor(code);
    let h = '<br><i>Likely fix:</i> ' + esc(fx.fix);
    if (fx.tierWord) h += '<br><i>Cost:</i> ' + esc(fx.tier + ' ' + fx.tierWord);
    if (fx.parts.length) h += partsHtml(fx.parts, rec);
    return h;
  }
  const li = (f, rec, withFix) => '<li><b>' + TAG[f.level] + ':</b> ' + esc(f.title) + (f.detail ? ' \u2014 ' + esc(f.detail) : '') +
    (withFix ? (f.code ? fixHtml(f.code, rec) : f.moduleCode ? fixHtml(f.moduleCode, rec, f.module) : f.parts ? partsHtml(f.parts, rec) : '') : '') + '</li>';
  // opts.customer: plain summary for a customer (Trade mode): no prices, parts links, flags or our math
  function reportLines(rec, opts) {
    opts = opts || {};
    const m = modeOf(rec), cust = !!opts.customer, L = [];
    const a = rec.assessment, s = rec.scan;
    if (m.money === 'bid' && !cust) {
      const call = theCall(rec);
      L.push('<b>' + esc(call.word.toUpperCase()) + '</b>' + (call.mb ? ' \u00b7 ' + m.resultName + ' ' + esc(call.mb.bid > 0 ? money(call.mb.bid) : 'none') : '') + (rec.stock ? ' \u00b7 ' + esc(m.stockLabel) + ' ' + esc(rec.stock) : ''));
      if (call.flags.length) L.push('<b>Red flags:</b><ul>' + call.flags.map((f) => '<li>' + esc(f.title) + (f.detail ? ' \u2014 ' + esc(f.detail) : '') + '</li>').join('') + '</ul>');
      if (call.mb) L.push(m.resultName + ' math: sale ' + money(call.mb.sale) + ' \u2212 recon ' + money(call.mb.recon) + ' \u2212 ' + (m.id === 'trade' ? 'gross ' : 'profit ') + money(call.mb.profit) + (call.mb.fees ? ' \u2212 ' + esc(m.feesName.toLowerCase()) + ' ' + money(call.mb.fees) : '') + ' = ' + (call.mb.bid > 0 ? money(call.mb.bid) : 'none') +
        (call.mb.equity != null ? '. Payoff ' + money(call.mb.payoff) + ', ' + (call.mb.equity >= 0 ? 'equity ' + money(call.mb.equity) : 'upside down ' + money(-call.mb.equity)) : ''));
    }
    L.push('<b>' + (cust ? 'Vehicle health check' : m.id === 'checkin' ? 'OBD2 check-in scan' : 'Scan health') + ': ' + esc(LEVEL_WORD[a.overall]) + '</b>');
    L.push(esc(new Date(rec.at).toLocaleString()) + (rec.tech ? ' \u00b7 ' + esc(rec.tech) : ''));
    const info = [];
    if (rec.vin) info.push('VIN ' + esc(rec.vin));
    if (rec.decoded) info.push(esc(rec.decoded.label));
    if (rec.miles) info.push((rec.milesSource === 'truck' ? 'Truck computer ' : 'Dash ') + (+rec.miles).toLocaleString() + ' mi');
    if (info.length) L.push(info.join(' \u00b7 '));
    const bt = bigTicket(rec);
    if (bt.any && !cust) L.push('<b>' + (m.id === 'checkin' ? 'OVER $1,000' + (bt.codes.length ? ' (' + esc(bt.codes.join(', ')) + ')' : '') + ': Jonathan decides fix, wholesale or sell as-is before work starts.' : 'LIKELY OVER $1,000 IN RECON' + (bt.codes.length ? ' (' + esc(bt.codes.join(', ')) + ')' : '') + '.') + '</b>');
    L.push('<ul>' + a.findings.map((f) => li(f, rec, !cust)).join('') + '</ul>');
    if (rec.crankAssessment) L.push('<b>Cranking test:</b><ul>' + rec.crankAssessment.findings.map((f) => li(f, rec, !cust)).join('') + '</ul>');
    const dn = rec.drive && rec.drive.lane ? 'Lane drive' : 'Test drive';
    if (rec.driveAssessment) {
      const da = rec.driveAssessment;
      L.push('<b>' + dn + ': ' + esc(LEVEL_WORD[da.overall]) + '</b>' + (da.stats ? ' (' + da.stats.minutes + ' min, ' + da.stats.miles + ' mi, top ' + da.stats.maxMph + ' mph)' : ''));
      L.push('<ul>' + da.findings.map((f) => li(f, rec, !cust)).join('') + '</ul>');
    } else if (!cust) L.push(m.driveName + ' not recorded in the app.');
    if (rec.estimate && rec.estimate.lines.length && !cust) {
      L.push('<b>' + esc(m.estimateName) + ': $' + estTotal(rec).toLocaleString() + '</b><ul>' + rec.estimate.lines.map((l) => '<li>' + esc(l.label) + ': $' + (+l.amount || 0).toLocaleString() + '</li>').join('') + '</ul>');
    }
    if (rec.idleAssessment) {
      const ia = rec.idleAssessment;
      L.push('<b>Idle &amp; misfire check: ' + esc(LEVEL_WORD[ia.overall]) + '</b>' + (ia.stats ? ' (avg ' + ia.stats.mean + ' RPM, range ' + ia.stats.min + '\u2013' + ia.stats.max + ')' : ''));
      L.push('<ul>' + ia.findings.map((f) => li(f, rec, !cust)).join('') + '</ul>');
      if (rec.idle && rec.idle.misfires && !cust) L.push('Misfire counters by cylinder: ' + rec.idle.misfires.map((x) => x.cyl + ': ' + Math.max(x.avg10 || 0, x.lastTrip || 0)).join(', '));
    } else if (!cust) L.push('Idle check not run.');
    const extra = [];
    if (s.distSinceClearMi != null) extra.push('Since codes cleared: ' + s.distSinceClearMi + ' mi' + (s.warmupsSinceClear != null ? ', ' + s.warmupsSinceClear + ' warm-ups' : ''));
    if (s.status && s.status.monitors.length) extra.push('Self-tests not finished: ' + (s.status.monitors.filter((x) => !x.complete).map((x) => x.name).join(', ') || 'none'));
    if (rec.recalls) extra.push(rec.recalls.count + ' recall(s) on file for this year/model');
    if (extra.length) L.push(extra.map(esc).join('<br>'));
    if (rec.vin) L.push('<a href="https://www.nhtsa.gov/recalls?vin=' + esc(rec.vin) + '">Check this VIN for open recalls</a>');
    if (rec.notes && !cust) L.push('<b>Notes:</b> ' + esc(rec.notes).replace(/\n/g, '<br>'));
    L.push('<i>Read-only scan ' + (cust ? 'by Little Country Cars' : 'from Vehicle Scan (' + m.label + ' mode)') + '; no codes were cleared.</i>');
    return L.join('<br>');
  }
  function shareText(rec, opts) {
    const html = reportLines(rec, opts).replace(/<br\s*\/?>(?!<ul>)/g, '\n').replace(/<li>/g, '\n\u2022 ').replace(/<\/(ul|li)>/g, '');
    const t = document.createElement('div'); t.innerHTML = html.replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2 ($1)');
    return t.textContent.replace(/\n{3,}/g, '\n\n').trim();
  }
  async function share(rec, opts) {
    rec = rec || current; if (!rec) return;
    opts = opts || {};
    if (rec === current) keepFields(); else saveHist(rec);
    const m = modeOf(rec);
    const what = opts.customer ? 'Vehicle health check' : (m.id === 'trade' ? 'Trade appraisal' : m.id === 'auction' ? 'Appraisal' : 'Check-in scan');
    const title = what + ': ' + ((rec.decoded && rec.decoded.label) || rec.vin || 'vehicle') + (rec.stock && !opts.customer ? ' (' + m.stockShort + ' ' + rec.stock + ')' : '');
    const text = title + '\n\n' + shareText(rec, opts);
    const msg = $('sendMsg');
    try {
      if (navigator.share) { await navigator.share({ title, text }); return; }
      await navigator.clipboard.writeText(text);
      msg.className = 'notice ok'; msg.textContent = 'Summary copied. Paste it into a text or email.'; show(msg);
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      msg.className = 'notice err'; msg.textContent = 'Couldn\u2019t share. Use Save PDF instead.'; show(msg);
    }
  }

  /* ---------- monday.com: Check-In mode only ---------- */
  async function mq(query, variables) {
    if (!settings.token) throw new Error('NO_TOKEN');
    const res = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: settings.token },
      body: JSON.stringify({ query, variables: variables || {} })
    });
    let j = null; try { j = await res.json(); } catch (e) {}
    if (res.status === 401 || res.status === 403) throw new Error('monday.com didn\u2019t accept the token. Check it in Settings.');
    if (!res.ok || !j) throw new Error('monday.com error (' + res.status + ')');
    if (j.errors && j.errors.length) throw new Error(j.errors.map((e) => e.message).join('; '));
    if (j.error_message) throw new Error(j.error_message);
    return j.data;
  }
  const ITEM_FIELDS = 'id name url column_values(ids:["' + COL.stock + '"]){ id text } subitems { id name column_values(ids:["' + SUB.status + '","' + SUB.notes + '","' + SUB.parts + '"]){ id text } }';
  async function findByStock(stock) {
    const d = await mq('query($b:ID!,$v:[String]!){ items_page_by_column_values(board_id:$b, limit:5, columns:[{column_id:"' + COL.stock + '", column_values:$v}]){ items{ ' + ITEM_FIELDS + ' } } }',
      { b: BOARD, v: [stock] });
    return (d.items_page_by_column_values && d.items_page_by_column_values.items) || [];
  }
  async function searchByName(q) {
    const d = await mq('query($b:[ID!]){ boards(ids:$b){ items_page(limit:10, query_params:{rules:[{column_id:"name", compare_value:["' + q.replace(/["\\]/g, '') + '"], operator:contains_text}]}){ items{ ' + ITEM_FIELDS + ' } } } }', { b: [BOARD] });
    return (d.boards && d.boards[0] && d.boards[0].items_page.items) || [];
  }
  async function lookupMatch() {
    if (!isMonday() || !current) return;
    const box = $('matchBox'); match = null; sendMode = 'match';
    show($('newBox'), false); show($('searchBox'), false);
    $('fillSubs').checked = settings.fill;
    $('sendBtn').disabled = true;
    const stock = current.stock;
    if (current.demo) { box.innerHTML = '<span><b>Practice scan.</b> Demo trucks don\u2019t post to monday.com. Connect the real scanner to send.</span>'; $('sendBtn').textContent = 'Send to monday.com'; return; }
    if (!settings.token) { box.innerHTML = '<span>Add your monday.com token (gear at the top) to send this scan to Inventory Recon.</span>'; return; }
    if (!stock) { box.innerHTML = '<span>No VIN came back, so there\u2019s no stock # to match. Type the stock # above, or search the board.</span>'; show($('searchBox')); return; }
    box.innerHTML = '<span class="muted small">Looking up stock # ' + esc(stock) + ' on Inventory Recon\u2026</span>';
    try {
      const items = await findByStock(stock);
      if (items.length === 1) setMatch(items[0], 'Matched by stock #');
      else if (items.length > 1) {
        box.innerHTML = '<span><b>' + items.length + ' vehicles</b> on the board have stock # ' + esc(stock) + '. Pick one:</span>';
        show($('searchBox')); listResults(items);
      } else {
        box.innerHTML = '<span>No vehicle with stock # <b>' + esc(stock) + '</b> on Inventory Recon yet. Send will add it as a new vehicle, or search for it if it\u2019s there under another stock #.</span>';
        sendMode = 'new'; show($('newBox')); show($('searchBox')); suggestName();
        $('sendBtn').disabled = false; $('sendBtn').textContent = 'Add vehicle & send';
      }
    } catch (e) {
      box.innerHTML = '';
      const s = document.createElement('span'); s.textContent = e.message === 'NO_TOKEN' ? 'Add your monday.com token in Settings.' : 'Couldn\u2019t reach monday.com: ' + e.message + '. The scan is saved on this phone; send it later from Recent scans.';
      box.appendChild(s);
    }
  }
  function setMatch(item, how) {
    match = item; sendMode = 'match';
    const box = $('matchBox'); box.textContent = '';
    const a = document.createElement('span'); a.className = 'muted small'; a.textContent = how;
    const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = item.name;
    const stockTxt = (item.column_values.find((c) => c.id === COL.stock) || {}).text;
    const b = document.createElement('span'); b.className = 'muted small'; b.textContent = 'Stock # ' + (stockTxt || '(blank, will be set to ' + current.stock + ')');
    box.append(a, link, b);
    show($('newBox'), false); show($('searchBox'), false);
    $('sendBtn').disabled = false; $('sendBtn').textContent = 'Send to monday.com';
  }
  function suggestName() {
    if (!isMonday() || sendMode !== 'new' || !current || $('newName').value) return;
    const d = current.decoded; const miles = current.miles;
    const parts = d ? [d.year, (d.model || '').replace(/-/g, ''), d.trim] : [];
    if (miles) parts.push(Math.round(miles / 1000) + 'k');
    $('newName').value = parts.filter(Boolean).join(' ');
  }
  function listResults(items) {
    const ul = $('searchResults'); ul.textContent = '';
    if (!items.length) { const l = document.createElement('li'); l.textContent = 'Nothing found.'; ul.appendChild(l); return; }
    for (const it of items) {
      const l = document.createElement('li');
      const s = document.createElement('span'); s.textContent = it.name;
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Use'; b.style.minHeight = '40px';
      b.onclick = () => setMatch(it, 'Picked from search');
      l.append(s, b); ul.appendChild(l);
    }
  }
  let testArmedAt = 0;
  async function send(rec, opts = {}) {
    rec = rec || current;
    if (!rec || rec.demo || (rec.mode && rec.mode !== 'checkin')) return;
    const msg = $('sendMsg');
    if (TEST && Date.now() - testArmedAt > 8000) {
      testArmedAt = Date.now();
      msg.className = 'notice err'; show(msg);
      msg.textContent = 'This is the TEST app, but it posts to the real Inventory Recon board. Tap Send again within 8 seconds to send it.';
      return;
    }
    testArmedAt = 0;
    msg.className = 'notice'; msg.textContent = 'Sending\u2026'; show(msg);
    $('sendBtn').disabled = true;
    try {
      rec.notes = opts.fromHistory ? rec.notes : $('notes').value.trim();
      let item = opts.item || (rec === current ? match : null);
      if (!item) {
        const found = rec.stock ? await findByStock(rec.stock) : [];
        if (found.length === 1) item = found[0];
        else if (found.length > 1) throw new Error('More than one vehicle has stock # ' + rec.stock + '. Open the scan and pick one.');
      }
      if (!item) {
        const name = (rec === current ? $('newName').value.trim() : '') || [rec.decoded && rec.decoded.year, rec.decoded && rec.decoded.model, rec.stock].filter(Boolean).join(' ') || 'Stock ' + rec.stock;
        const cv = {}; cv[COL.stock] = rec.stock; cv[COL.stage] = { label: 'Initial Inspection' }; cv[COL.location] = { label: 'On Site' };
        const d = await mq('mutation($b:ID!,$n:String!,$cv:JSON!){ create_item(board_id:$b, item_name:$n, column_values:$cv){ ' + ITEM_FIELDS + ' } }',
          { b: BOARD, n: name, cv: JSON.stringify(cv) });
        item = d.create_item;
      } else {
        const stockTxt = (item.column_values.find((c) => c.id === COL.stock) || {}).text;
        if (!stockTxt && rec.stock) {
          const cv = {}; cv[COL.stock] = rec.stock;
          await mq('mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b, item_id:$i, column_values:$cv){ id } }', { b: BOARD, i: item.id, cv: JSON.stringify(cv) });
        }
      }
      await mq('mutation($i:ID!,$body:String!){ create_update(item_id:$i, body:$body){ id } }', { i: item.id, body: reportLines(rec) });
      if (rec.estimate && rec.estimate.lines.length) {
        const cv = {}; cv[COL.estimate] = String(estTotal(rec));
        await mq('mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b, item_id:$i, column_values:$cv){ id } }', { b: BOARD, i: item.id, cv: JSON.stringify(cv) });
      }
      const fill = opts.fromHistory ? settings.fill : $('fillSubs').checked;
      let filled = 0;
      if (fill && item.subitems && item.subitems.length) {
        const day = new Date(rec.at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
        const findSub = (re) => item.subitems.find((s) => re.test(s.name));
        const cel = findSub(/^walk-around:\s*check engine/i);
        const bat = findSub(/^walk-around:\s*battery/i);
        const s = rec.scan, a = rec.assessment;
        const celFindings = a.findings.filter((f) => /^[PCBU][0-9A-F]{4}|Check engine|cleared recently|self-tests not finished/i.test(f.title) && f.level !== 'good');
        const celOk = !(s.status && s.status.mil) && !celFindings.some((f) => f.level === 'problem') && !(s.stored || []).length && !(s.pending || []).length;
        const updates = [];
        if (cel) {
          const note = 'Scan ' + day + ': ' + (s.status && s.status.mil ? 'light ON. ' : 'light off. ') +
            ((s.stored || []).length ? 'Stored ' + s.stored.join(', ') + '. ' : '') + ((s.pending || []).length ? 'Pending ' + s.pending.join(', ') + '. ' : '') +
            (s.distSinceClearMi != null ? s.distSinceClearMi + ' mi since codes cleared.' : '');
          const codes = codesOf(rec);
          const fixes = codes.map((c) => c + ': ' + OBD.fixFor(c).fix).join('\n');
          const parts = [...new Set(codes.flatMap((c) => OBD.fixFor(c).parts))].join(', ');
          updates.push([cel, celOk ? 'Done' : 'Needs Attention', (note.trim() + (fixes ? '\n' + fixes : '')), parts]);
        }
        const batF = a.findings.find((f) => /Battery|charging|Overcharging/i.test(f.title));
        if (bat && batF) updates.push([bat, batF.level === 'good' ? 'Done' : 'Needs Attention', 'Scan ' + day + ': ' + batF.title + '.']);
        for (const [sub, label, note, parts] of updates) {
          const old = (sub.column_values.find((c) => c.id === SUB.notes) || {}).text || '';
          const cv = {}; cv[SUB.status] = { label }; cv[SUB.notes] = { text: old ? old + '\n' + note : note };
          if (parts) {
            const oldParts = (sub.column_values.find((c) => c.id === SUB.parts) || {}).text || '';
            cv[SUB.parts] = oldParts ? oldParts + ', ' + parts : parts;
          }
          await mq('mutation($b:ID!,$i:ID!,$cv:JSON!){ change_multiple_column_values(board_id:$b, item_id:$i, column_values:$cv){ id } }', { b: SUB_BOARD, i: sub.id, cv: JSON.stringify(cv) });
          filled++;
        }
      }
      const bt = bigTicket(rec);
      if (bt.any && !(rec.sent && rec.sent.flagged)) {
        try {
          await mq('mutation($u:ID!,$t:ID!,$x:String!){ create_notification(user_id:$u, target_id:$t, target_type:Project, text:$x){ text } }',
            { u: JONATHAN, t: item.id, x: 'Check-in scan on ' + item.name + ': Day-1 estimate $' + bt.total.toLocaleString() + (bt.codes.length ? ' (' + bt.codes.join(', ') + ')' : '') + '. Fix, wholesale or sell as-is?' });
          rec.flagged = true;
        } catch (e) { /* notification is a bonus; the update already carries the flag */ }
      }
      rec.sent = { itemId: item.id, url: item.url, name: item.name, at: new Date().toISOString(), flagged: !!rec.flagged };
      saveHist(rec);
      msg.className = 'notice ok'; msg.textContent = '';
      const t = document.createElement('span'); t.textContent = 'Sent to ' + item.name + (filled ? ' and filled in ' + filled + ' walk-around item' + (filled > 1 ? 's' : '') : '') + '. ';
      const l = document.createElement('a'); l.href = item.url; l.target = '_blank'; l.rel = 'noopener'; l.textContent = 'Open in monday.com';
      msg.append(t, l);
      if (rec === current) setMatch(item, 'Sent');
      $('sendBtn').textContent = 'Send again';
    } catch (e) {
      msg.className = 'notice err';
      msg.textContent = e.message === 'NO_TOKEN' ? 'Add your monday.com token in Settings (gear at the top).' : 'Not sent: ' + e.message + '. The scan is saved on this phone; try again from Recent scans.';
      saveHist(rec);
    } finally {
      $('sendBtn').disabled = false;
      renderHist();
    }
  }
  async function testToken() {
    const prev = settings.token; settings.token = $('token').value.trim();
    $('testMsg').textContent = 'Checking\u2026';
    try {
      const d = await mq('query($b:[ID!]){ me { name } boards(ids:$b){ name } }', { b: [BOARD] });
      $('testMsg').textContent = 'Works: signed in as ' + d.me.name + (d.boards && d.boards[0] ? ', can see ' + d.boards[0].name : ', but can\u2019t see Inventory Recon');
      if (!$('techName').value && d.me.name) $('techName').value = d.me.name.split(' ')[0];
    } catch (e) { $('testMsg').textContent = e.message === 'NO_TOKEN' ? 'Paste a token first.' : e.message; }
    settings.token = prev;
  }

  /* ---------- history (one list on the phone, shown per mode) ---------- */
  function keepRecent(h) {
    const now = Date.now();
    return h.filter((r) => (current && r.id === current.id) || now - new Date(r.at).getTime() < per(r.mode || 'checkin').keepDays * 86400000).slice(0, 500);
  }
  function saveHist(rec) {
    rec = rec || current; if (!rec) return;
    const h = store.get(LS.hist, []).filter((x) => x.id !== rec.id);
    h.unshift(rec);
    store.set(LS.hist, keepRecent(h));
    renderHist();
  }
  function purgeOld() { const h = store.get(LS.hist, []), k = keepRecent(h); if (k.length !== h.length) store.set(LS.hist, k); }
  function updateHist(rec) {
    if (!rec) return;
    const h = store.get(LS.hist, []); const i = h.findIndex((x) => x.id === rec.id);
    if (i >= 0) { h[i] = rec; store.set(LS.hist, h); renderHist(); } else saveHist(rec);
  }
  const daysWord = (d) => d === 1 ? '1 day' : d + ' days';
  function renderHist() {
    const h = store.get(LS.hist, []).filter((r) => (r.mode || 'checkin') === M.id);
    $('keepNote').textContent = 'Kept on this phone for ' + daysWord(per().keepDays) + ', then cleared automatically. Change it in Settings.';
    show($('histCard'), h.length > 0);
    const ul = $('hist'); ul.textContent = '';
    for (const rec of h.slice(0, 60)) {
      const l = document.createElement('li');
      const left = document.createElement('span');
      const dot = document.createElement('i'); dot.className = 'dot ' + ((rec.call && rec.call.level) || rec.assessment.overall);
      left.appendChild(dot);
      let label;
      if (M.id === 'checkin') label = (rec.sent ? rec.sent.name : (rec.stock || rec.vin || 'No VIN'));
      else {
        label = ((rec.decoded && rec.decoded.label) || rec.vin || 'No VIN') + (rec.stock ? ' \u00b7 ' + M.stockShort + ' ' + rec.stock : '') +
          (rec.call ? ' \u00b7 ' + rec.call.word + (rec.call.bid != null ? ' \u00b7 ' + (rec.call.bid > 0 ? money(rec.call.bid) : 'none') : '') : '');
      }
      const pend = rec.vin && !rec.decoded && !rec.demo && M.id !== 'checkin' ? ' \u00b7 lookup waiting for signal' : '';
      left.appendChild(document.createTextNode(label + ' \u00b7 ' + new Date(rec.at).toLocaleDateString() + (rec.demo ? ' (demo)' : '') + pend));
      l.appendChild(left);
      if (M.id === 'checkin') {
        if (rec.sent) { const a = document.createElement('a'); a.href = rec.sent.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open'; a.style.color = 'inherit'; l.appendChild(a); }
        else if (!rec.demo) { const b = document.createElement('button'); b.className = 'btn'; b.style.minHeight = '40px'; b.textContent = 'Send'; b.onclick = () => send(rec, { fromHistory: true }); l.appendChild(b); }
      } else { const b = document.createElement('button'); b.className = 'btn'; b.style.minHeight = '40px'; b.textContent = 'Share'; b.onclick = () => share(rec); l.appendChild(b); }
      ul.appendChild(l);
    }
  }

  /* ---------- settings ---------- */
  function openSettings() {
    const p = per();
    $('techName').value = settings.name; $('token').value = settings.token; $('fillDefault').checked = settings.fill; $('testMsg').textContent = '';
    $('minProfit').value = p.minProfit; $('feesTransport').value = p.fees || '';
    const sel = $('keepDays'); sel.textContent = '';
    const opts = [...new Set([...(M.keepOptions || [M.keepDays]), p.keepDays])].sort((a, b) => a - b);
    for (const d of opts) { const o = document.createElement('option'); o.value = d; o.textContent = daysWord(d) + (d === M.keepDays ? ' (default)' : ''); sel.appendChild(o); }
    sel.value = String(p.keepDays);
    $('settings').showModal();
  }
  function saveSettings() {
    const pm = Object.assign({}, settings.per[M.id]);
    if (isBid()) { pm.minProfit = $('minProfit').value === '' ? M.minProfit : +$('minProfit').value; pm.fees = +$('feesTransport').value || 0; }
    pm.keepDays = +$('keepDays').value || M.keepDays;
    settings = Object.assign(settings, { name: $('techName').value.trim(), token: $('token').value.trim(), fill: $('fillDefault').checked });
    settings.per[M.id] = pm;
    store.set(LS.settings, settings);
    purgeOld(); renderHist(); updateSetup();
    if (current) { if (isBid()) { renderBid(); renderCall(); } if (isMonday() && !current.sent) lookupMatch(); }
  }
  function updateSetup() {
    const needToken = isMonday() && !settings.token;
    show($('setupCard'), needToken || store.get(LS.port, null) == null);
    $('setupToken').style.opacity = needToken ? 1 : .5;
  }

  /* ---------- wire up ---------- */
  $('connectBtn').onclick = () => connect('serial');
  $('otherBtn').onclick = () => connect('choose');
  $('bleBtn').onclick = () => connect('ble');
  $('demoBtn').onclick = () => connect('demo');
  $('retryBtn').onclick = () => connect(lastKind === 'demo' ? 'serial' : lastKind);
  $('logCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(clog.join('\n')); $('logCopy').textContent = 'Copied'; }
    catch (e) { $('logCopy').textContent = 'Select the text to copy'; }
    setTimeout(() => { $('logCopy').textContent = 'Copy log'; }, 2000);
  };
  $('logClear').onclick = () => { clog.length = 0; $('connLog').textContent = ''; };
  $('disconnectBtn').onclick = disconnect;
  $('scanBtn').onclick = scan;
  $('quickBtn').onclick = quick;
  $('nextBtn').onclick = nextVehicle; $('nextTop').onclick = nextVehicle;
  $('scoutBtn').onclick = lookupScout;
  $('scoutCallBtn').onclick = lookupScout;
  document.addEventListener('visibilitychange', backFromScout);
  window.addEventListener('hashchange', takeFromLink);
  $('salePrice').addEventListener('input', () => { if (current) { current.salePrice = +$('salePrice').value || null; renderBid(); renderCall(); } });
  $('salePrice').addEventListener('change', () => { if (current) updateHist(current); });
  $('payoff').addEventListener('input', () => { if (current) { current.payoff = +$('payoff').value || null; renderBid(); renderCall(); } });
  $('payoff').addEventListener('change', () => { if (current) updateHist(current); });
  window.addEventListener('online', retryPending);
  setInterval(retryPending, 60000);
  $('idleBtn').onclick = () => runIdle(30);
  $('crankBtn').onclick = runCrank;
  $('driveBtn').onclick = startDrive;
  $('driveEnd').onclick = () => { if (driveAbort) driveAbort.abort(); };
  $('estAdd').onclick = addLine;
  $('shareBtn').onclick = () => share(current);
  $('custBtn').onclick = () => share(current, { customer: true });
  $('sendBtn').onclick = () => send(current, sendMode === 'match' && match ? { item: match } : {});
  $('printBtn').onclick = $('printBtnM').onclick = () => { keepFields(); window.print(); };
  $('searchBtn').onclick = async () => {
    const q = $('searchQ').value.trim(); if (!q) return;
    try { listResults(await searchByName(q)); } catch (e) { listResults([]); }
  };
  $('miles').addEventListener('change', () => { if (current) { current.miles = +$('miles').value || null; current.milesSource = 'dash'; renderScan(); renderCall(); updateHist(current); } });
  $('stock').addEventListener('change', () => { if (current) { current.stock = $('stock').value.trim().toUpperCase(); $('stock').value = current.stock; saveHist(); if (isMonday()) lookupMatch(); } });
  $('settingsBtn').onclick = openSettings;
  $('settings').addEventListener('close', saveSettings);
  $('testBtn').onclick = testToken;
  $('modeBtn').onclick = openModes;
  $('changeMode').onclick = () => { $('settings').close(); openModes(); };
  $('modeDlg').addEventListener('close', () => { const v = $('modeDlg').returnValue; if (v && MODES[v]) setMode(v); else if (!modeId) setMode(M.id); });
  $('clearHist').onclick = () => {
    if (!confirm('Delete the ' + M.records + ' saved on this phone?' + (isMonday() ? ' Anything already sent stays in monday.com.' : ''))) return;
    store.set(LS.hist, store.get(LS.hist, []).filter((r) => (r.mode || 'checkin') !== M.id)); renderHist();
  };

  const sm = supportMsg(); if (sm) err($('connectErr'), sm);
  if (!('bluetooth' in navigator)) show($('bleBtn'), false);
  purgeOld(); setPill(); applyMode(); takeFromLink(); setTimeout(retryPending, 3000);
  if (!modeId) openModes();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
