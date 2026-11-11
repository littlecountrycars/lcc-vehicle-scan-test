/* LCC Vehicle Scan: shared OBD2 engine for every mode (Check-In, Auction, Trade). Owner: Dylan.
   Talks to ELM327-style adapters (Veepeak, OBDLink, Vgate...) over:
     - Classic Bluetooth via Web Serial (Chrome 138+ on Android; adapter paired in Android settings first)
     - Bluetooth LE via Web Bluetooth
     - Demo (no adapter)
   Read-only: this file never sends a clear-codes command (mode 04). */
(function (root) {
  'use strict';

  const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
  // Common BLE serial services used by ELM327 clones and branded adapters
  const BLE_SERVICES = [
    0xfff0, 0xffe0, 0x18f0, 0xae30, 0xffb0, 0xbeef,
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Vgate / some Veepeak BLE+
    '0000fff0-0000-1000-8000-00805f9b34fb'
  ];
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  const kmToMi = (km) => Math.round(km * 0.621371);

  /* ---------- Transports: each has open(), write(str), onData(cb), close(), name ---------- */

  class SerialTransport {
    constructor(port) { this.port = port; this.name = 'Bluetooth'; this._cb = () => {}; this.log = () => {}; }
    static supported() { return !!(root.navigator && navigator.serial); }
    static async pick() {
      // Previously granted port: reconnect without the picker
      const known = await navigator.serial.getPorts();
      if (known.length) return new SerialTransport(known[known.length - 1]);
      return SerialTransport.choose();
    }
    static async choose() {
      const port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] });
      return new SerialTransport(port);
    }
    info() {
      try {
        const i = this.port.getInfo() || {};
        return Object.keys(i).length ? Object.entries(i).map(([k, v]) => k + '=' + v).join(', ') : 'no details';
      } catch (e) { return 'no details'; }
    }
    onData(cb) { this._cb = cb; }
    // Bluetooth links on Android often fail the first try (radio busy, adapter waking up). Try a few times.
    async open(tries = 3) {
      let last;
      for (let i = 1; i <= tries; i++) {
        try {
          this.log('Opening Bluetooth link, try ' + i + ' of ' + tries);
          await this.port.open({ baudRate: 38400 });
          this.writer = this.port.writable.getWriter();
          this.reader = this.port.readable.getReader();
          this._loop();
          this.log('Bluetooth link open');
          return;
        } catch (e) {
          last = e;
          this.log('Try ' + i + ' failed: ' + (e.name || 'Error') + ': ' + (e.message || e));
          if (/already open/i.test(e.message || '')) {
            try { await this.close(); } catch (x) {}
          }
          if (i < tries) await sleep(1500);
        }
      }
      throw last;
    }
    async _loop() {
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this._cb(dec.decode(value));
        }
      } catch (e) { this.log('Link read stopped: ' + (e.message || e)); }
    }
    async write(s) { await this.writer.write(enc.encode(s)); }
    async close() {
      try { await this.reader.cancel(); } catch (e) {}
      try { this.reader.releaseLock(); } catch (e) {}
      try { this.writer.releaseLock(); } catch (e) {}
      try { await this.port.close(); } catch (e) {}
    }
  }

  class BleTransport {
    constructor(device) { this.device = device; this.name = 'Bluetooth LE'; this._cb = () => {}; }
    static supported() { return !!(root.navigator && navigator.bluetooth); }
    static async pick() {
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      return new BleTransport(device);
    }
    onData(cb) { this._cb = cb; }
    async open() {
      const server = await this.device.gatt.connect();
      const services = await server.getPrimaryServices();
      let rx = null, tx = null;
      for (const svc of services) {
        let chars = [];
        try { chars = await svc.getCharacteristics(); } catch (e) { continue; }
        for (const c of chars) {
          if (!rx && (c.properties.notify || c.properties.indicate)) rx = c;
          if (!tx && (c.properties.write || c.properties.writeWithoutResponse)) tx = c;
        }
        if (rx && tx) break;
      }
      if (!rx || !tx) throw new Error('This Bluetooth device does not look like an OBD2 adapter.');
      this.rx = rx; this.tx = tx;
      rx.addEventListener('characteristicvaluechanged', (ev) => this._cb(dec.decode(ev.target.value)));
      await rx.startNotifications();
    }
    async write(s) {
      const bytes = enc.encode(s);
      for (let i = 0; i < bytes.length; i += 20) {
        const chunk = bytes.slice(i, i + 20);
        if (this.tx.properties.writeWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
        else await this.tx.writeValue(chunk);
      }
    }
    async close() { try { this.device.gatt.disconnect(); } catch (e) {} }
  }

  // Pretend truck for training and testing: a 2018 F-150 with a misfire and codes cleared recently
  class DemoTransport {
    constructor(script) { this.name = 'Demo'; this._cb = () => {}; this.script = script || DEMO_TRUCK; }
    onData(cb) { this._cb = cb; }
    async open() {}
    async write(s) {
      const cmd = s.trim().toUpperCase().replace(/\s+/g, '');
      if (cmd.startsWith('ATSH')) this.hdr = cmd.slice(4);
      if (cmd === 'ATSP0' || cmd === 'ATSH7DF') this.hdr = null;
      let ans = this.hdr && this.script[this.hdr + ':' + cmd] !== undefined ? this.script[this.hdr + ':' + cmd] : this.script[cmd];
      if (this.hdr && cmd === '19028F' && ans === undefined) ans = 'NO DATA';
      if (typeof ans === 'function') ans = ans();
      if (ans === undefined) ans = cmd.startsWith('AT') ? 'OK' : 'NO DATA';
      await sleep(cmd === '0100' ? 700 : 60);
      this._cb(ans + '\r\r>');
    }
    async close() {}
  }

  const DEMO_TRUCK = {
    ATZ: '\r\rELM327 v1.5', ATE0: 'OK', ATDPN: 'A6', ATRV: '12.3V', ATI: 'ELM327 v1.5',
    '0100': '41 00 BE 3F B8 13\r41 00 98 18 80 11',
    '0120': '41 20 A0 07 B0 11',
    '0140': '41 40 FE D0 00 00',
    '0101': '41 01 82 07 E5 65',
    '0105': '41 05 6F',
    '010C': '41 0C 00 00',
    '012F': '41 2F 7F',
    '0121': '41 21 00 00',
    '0130': '41 30 03',
    '0131': '41 31 00 2A',
    '014D': '41 4D 00 00',
    '0142': '41 42 30 0C',
    '0902': '014\r0: 49 02 01 31 46 54\r1: 45 57 31 45 50 34 4A\r2: 46 44 30 30 30 34 32',
    '03': '43 02 03 03 01 71',
    '07': '47 01 04 20',
    '0A': '4A 00',
    '7E0:22DD01': '62 DD 01 02 0B 4E'
  };
  // Demo idle: engine running, rough on cylinder 3, running lean
  (function () {
    let t = 0;
    const b2 = (v) => hex2((v >> 8) & 255) + ' ' + hex2(v & 255);
    DEMO_TRUCK.demoRunning = false;
    DEMO_TRUCK['010C'] = () => {
      if (!DEMO_TRUCK.demoRunning) return '41 0C 00 00';
      t++;
      let rpm = 680 + Math.round(Math.sin(t / 3) * 12 + (Math.random() - 0.5) * 20);
      if (t % 7 === 0) rpm -= 70 + Math.round(Math.random() * 40); // stumble
      return '41 0C ' + b2(rpm * 4);
    };
    DEMO_TRUCK['0105'] = () => DEMO_TRUCK.demoRunning ? '41 05 ' + hex2(40 + 88) : '41 05 6F';
    DEMO_TRUCK['0104'] = '41 04 3A';
    DEMO_TRUCK['0106'] = () => '41 06 ' + hex2(128 + Math.round(9 * 1.28 + (Math.random() - 0.5) * 6));
    DEMO_TRUCK['0107'] = '41 07 8F';
    DEMO_TRUCK['0108'] = () => '41 08 ' + hex2(128 + Math.round(4 * 1.28 + (Math.random() - 0.5) * 6));
    DEMO_TRUCK['0109'] = '41 09 86';
    DEMO_TRUCK['010E'] = '41 0E 90';
    DEMO_TRUCK['0110'] = '41 10 01 F4';
    DEMO_TRUCK.crankAt = 0;
    DEMO_TRUCK.ATRV = () => {
      if (DEMO_TRUCK.crankAt) {
        const e = Date.now() - DEMO_TRUCK.crankAt;
        if (e < 2500) return '12.3V';
        if (e < 3800) return (9.9 + Math.random() * 0.5).toFixed(1) + 'V';
        DEMO_TRUCK.demoRunning = true;
        return (14.1 + Math.random() * 0.2).toFixed(1) + 'V';
      }
      return DEMO_TRUCK.demoRunning ? '14.2V' : '12.3V';
    };
    DEMO_TRUCK['06A0'] = '46 A0 7F 80 00 00';
    Object.assign(DEMO_TRUCK, {
      '7E0:19028F': '59 02 FF', '760:19028F': '59 02 FF 40 35 28 08', '737:19028F': '59 02 FF', '720:19028F': '59 02 FF', '726:19028F': '59 02 FF',
      '020200': '42 02 00 03 03', '020C00': '42 0C 00 0A 28', '020D00': '42 0D 00 00', '020500': '42 05 00 7E', '020400': '42 04 00 40',
      '020600': '42 06 00 8C', '020700': '42 07 00 8F', '021100': '42 11 00 20'
    });
    DEMO_TRUCK.driveAt = 0;
    const demoDrive = () => {
      const e = (Date.now() - DEMO_TRUCK.driveAt) / 1000;
      const mph = e < 22 ? e * 2.5 : 55 + (Math.random() - 0.5) * 0.8;
      const ratio = mph < 12 ? 110 : mph < 22 ? 70 : mph < 32 ? 50 : mph < 42 ? 38 : mph < 50 ? 30 : 25;
      let rpm = Math.max(700, mph * ratio) + (Math.random() - 0.5) * 20;
      if (e > 9 && e < 9.8) rpm += 520;
      return { mph, rpm };
    };
    const base0D = '41 0D 00';
    DEMO_TRUCK['010D'] = () => DEMO_TRUCK.driveAt ? '41 0D ' + hex2(Math.round(demoDrive().mph / 0.621371)) : base0D;
    const idleRpm = DEMO_TRUCK['010C'];
    DEMO_TRUCK['010C'] = () => DEMO_TRUCK.driveAt ? '41 0C ' + b2(Math.round(demoDrive().rpm * 4)) : idleRpm();
    DEMO_TRUCK['0111'] = '41 11 30';
    const cyl = [3, 2, 61, 4, 1, 0, 2, 3];
    cyl.forEach((n, i) => {
      const mid = hex2(0xa2 + i);
      DEMO_TRUCK['06' + mid] = '013\r0: 46 ' + mid + ' 0B 24 ' + b2(n) + '\r1: 00 00 FF FF ' + mid + ' 0C 24\r2: ' + b2(Math.round(n * 1.4)) + ' 00 00 FF FF 00';
    });
  })();

  /* ---------- ELM327 command layer ---------- */

  const ERR_RE = /(UNABLE TO CONNECT|CAN ERROR|BUS ERROR|BUS INIT\.*\s*ERROR|FB ERROR|DATA ERROR|BUFFER FULL|STOPPED|ERR\d+|LV RESET|ACT ALERT)/;

  class Elm {
    constructor(transport) {
      this.t = transport; this.buf = ''; this.pending = null; this.queue = Promise.resolve();
      this.protocol = null; this.isCan = true; this.log = []; this.onLog = () => {};
      transport.onData((s) => this._onData(s));
    }
    _onData(s) {
      this.buf += s;
      if (this.pending && this.buf.includes('>')) {
        const raw = this.buf.slice(0, this.buf.indexOf('>'));
        this.buf = this.buf.slice(this.buf.indexOf('>') + 1);
        const p = this.pending; this.pending = null; p.resolve(raw);
      }
    }
    send(cmd, timeout = 4000) {
      const run = async () => {
        this.buf = '';
        const raw = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending = null;
            this.onLog('\u2192 ' + cmd + '   \u2190 no reply in ' + (timeout / 1000) + 's' + (this.buf ? ' (partial: ' + this.buf.replace(/[\r\n]+/g, ' | ').trim() + ')' : ''));
            reject(new Error('timeout: ' + cmd));
          }, timeout);
          this.pending = { resolve: (v) => { clearTimeout(timer); resolve(v); } };
          this.t.write(cmd + '\r').catch((e) => { clearTimeout(timer); this.pending = null; reject(e); });
        });
        const lines = cleanLines(raw, cmd);
        this.log.push({ cmd, raw: lines.join(' | ') });
        this.onLog('\u2192 ' + cmd + '   \u2190 ' + (raw.replace(/[\r\n]+/g, ' | ').trim() || '(empty)'));
        return lines;
      };
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }
    // Is the adapter itself talking? Works with the key off. Returns its ID text, or throws NO_ADAPTER.
    async hello() {
      for (const c of ['ATZ', 'ATI']) {
        try {
          const r = await this.send(c, c === 'ATZ' ? 3000 : 2000);
          const t = r.join(' ');
          if (/ELM|OBD|V\d|>/i.test(t) || t.length) return t || 'answered';
        } catch (e) {}
      }
      throw new Error('NO_ADAPTER');
    }
    async init(progress = () => {}) {
      progress('Waking up the adapter');
      try { await this.send('ATZ', 5000); } catch (e) { /* some clones ignore ATZ */ }
      await sleep(300);
      for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATAT1', 'ATST96', 'ATSP0']) {
        try { await this.send(c, 2000); } catch (e) {}
      }
      progress('Finding the truck’s computer');
      const r = await this.send('0100', 20000);
      const txt = r.join(' ');
      if (ERR_RE.test(txt) || /NO DATA/.test(txt) || !r.some((l) => /41\s?00/.test(l))) {
        throw new Error('NO_ECU');
      }
      try {
        const dp = (await this.send('ATDPN', 2000)).join('');
        const m = dp.match(/A?([0-9A-C])/i);
        this.protocol = m ? m[1].toUpperCase() : null;
        this.isCan = !this.protocol || /[6-9A-C]/.test(this.protocol);
      } catch (e) {}
      return txt;
    }
  }

  function cleanLines(raw, cmd) {
    return raw.replace(/\r\n?/g, '\n').split('\n')
      .map((l) => l.trim())
      .filter((l) => l && l.replace(/\s/g, '').toUpperCase() !== cmd.toUpperCase().replace(/\s/g, '') &&
        !/^SEARCHING/i.test(l) && !/^BUS INIT/i.test(l) && l !== 'OK' || /^(OK)$/.test(l) && cmd.startsWith('AT'));
  }

  /* ---------- Response parsing ---------- */

  // Turn response lines into messages (arrays of bytes), handling CAN multi-frame ("014", "0:", "1:")
  function parseMessages(lines, isCan = true) {
    const msgs = []; let cur = null; let want = 0;
    for (let line of lines) {
      line = line.toUpperCase().trim();
      if (!line || /NO DATA|\?|ERROR|STOPPED|UNABLE/.test(line)) continue;
      const lenLine = line.replace(/\s/g, '');
      if (isCan && /^[0-9A-F]{3}$/.test(lenLine)) { cur = []; want = parseInt(lenLine, 16); msgs.push(cur); continue; }
      const fm = line.match(/^([0-9A-F])\s*:\s*(.*)$/);
      if (fm) {
        const idx = parseInt(fm[1], 16);
        const bytes = hexBytes(fm[2]);
        if (idx === 0 && (!cur || cur.length)) { if (!cur || cur.length) { cur = []; msgs.push(cur); want = want || 0; } }
        if (!cur) { cur = []; msgs.push(cur); }
        cur.push(...bytes);
        if (want && cur.length >= want) { cur.length = want; cur = null; want = 0; }
        continue;
      }
      const bytes = hexBytes(line);
      if (bytes.length) { msgs.push(bytes); cur = null; want = 0; }
    }
    return msgs.filter((m) => m.length);
  }

  function hexBytes(s) {
    const h = s.replace(/[^0-9A-Fa-f]/g, '');
    const out = [];
    for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
    return out;
  }

  function pidData(msgs, pid) {
    const m = msgs.find((b) => b[0] === 0x41 && b[1] === pid);
    return m ? m.slice(2) : null;
  }

  function parseSupport(msgs, base) {
    const set = new Set();
    for (const b of msgs) {
      if (b[0] !== 0x41 || b[1] !== base) continue;
      const d = b.slice(2, 6);
      d.forEach((byte, i) => { for (let j = 0; j < 8; j++) if (byte & (0x80 >> j)) set.add(base + i * 8 + j + 1); });
    }
    return set;
  }

  function decodeDtc(a, b) {
    if (!a && !b) return null;
    const type = 'PCBU'[a >> 6];
    return type + ((a >> 4) & 3) + (a & 0xf).toString(16).toUpperCase() + b.toString(16).toUpperCase().padStart(2, '0');
  }

  function parseDtcs(msgs, sid, isCan = true) {
    const codes = new Set();
    for (const m of msgs) {
      if (m[0] !== sid) continue;
      let body = m.slice(1);
      if (isCan) {
        if (body.length % 2 === 1) body = body.slice(1); // count byte
      }
      for (let i = 0; i + 1 < body.length; i += 2) {
        const c = decodeDtc(body[i], body[i + 1]);
        if (c) codes.add(c);
      }
    }
    return [...codes];
  }

  const VIN_CHARS = /[A-HJ-NPR-Z0-9]/;
  function parseVin(msgs) {
    const parts = msgs.filter((m) => m[0] === 0x49 && m[1] === 0x02);
    if (!parts.length) return null;
    let bytes = [];
    if (parts.length === 1) bytes = parts[0].slice(3);
    else parts.sort((x, y) => x[2] - y[2]).forEach((p) => bytes.push(...p.slice(3)));
    const s = bytes.map((b) => String.fromCharCode(b)).filter((c) => VIN_CHARS.test(c)).join('');
    return s.length >= 17 ? s.slice(-17) : (s.length ? s : null);
  }

  function vinCheckOk(vin) {
    if (!vin || vin.length !== 17) return false;
    const map = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
    const w = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < 17; i++) { const c = vin[i]; const v = /\d/.test(c) ? +c : map[c]; if (v === undefined) return false; sum += v * w[i]; }
    const r = sum % 11; return vin[8] === (r === 10 ? 'X' : String(r));
  }

  function parseMonitors(d) {
    if (!d || d.length < 4) return null;
    const [A, B, C, D] = d;
    const diesel = !!(B & 0x08);
    const mons = [];
    const add = (name, supBit, incBit, sup, inc) => { if (sup & supBit) mons.push({ name, complete: !(inc & incBit) }); };
    add('Misfire', 0x01, 0x10, B, B);
    add('Fuel system', 0x02, 0x20, B, B);
    add('Components', 0x04, 0x40, B, B);
    const names = diesel
      ? ['NMHC catalyst', 'NOx / SCR', null, 'Boost pressure', null, 'Exhaust gas sensor', 'Particulate filter', 'EGR / VVT']
      : ['Catalyst', 'Heated catalyst', 'EVAP system', 'Secondary air', 'A/C refrigerant', 'Oxygen sensor', 'O2 sensor heater', 'EGR / VVT'];
    names.forEach((n, i) => { if (n) add(n, 1 << i, 1 << i, C, D); });
    return { mil: !!(A & 0x80), dtcCount: A & 0x7f, diesel, monitors: mons };
  }

  /* ---------- Full check-in scan ---------- */

  async function runScan(elm, progress = () => {}) {
    const r = { at: new Date().toISOString(), adapter: elm.t.name, protocol: elm.protocol, errors: [] };
    const q = async (cmd, t) => { try { return parseMessages(await elm.send(cmd, t), elm.isCan); } catch (e) { r.errors.push(cmd + ': ' + e.message); return []; } };

    progress('Checking what this truck reports');
    const sup = new Set();
    let base = 0x00;
    for (;;) {
      const s = parseSupport(await q('01' + hex2(base), 6000), base);
      s.forEach((p) => sup.add(p));
      if (!s.has(base + 0x20) || base >= 0xA0) break;
      base += 0x20;
    }
    r.supported = [...sup];

    progress('Reading the VIN');
    r.vin = parseVin(await q('0902', 6000));
    r.vinValid = vinCheckOk(r.vin);

    progress('Reading check engine light and monitors');
    r.status = parseMonitors(pidData(await q('0101'), 0x01));

    progress('Reading trouble codes');
    r.stored = parseDtcs(await q('03', 8000), 0x43, elm.isCan);
    r.pending = parseDtcs(await q('07', 8000), 0x47, elm.isCan);
    r.permanent = parseDtcs(await q('0A', 8000), 0x4a, elm.isCan);

    progress('Reading battery and engine data');
    try {
      const v = (await elm.send('ATRV', 2000)).join('').match(/(\d+(\.\d+)?)/);
      r.voltage = v ? +v[1] : null;
    } catch (e) { r.voltage = null; }
    const read = async (pid, fn) => {
      if (!sup.has(pid)) return null;
      const d = pidData(await q('01' + hex2(pid)), pid);
      return d ? fn(d) : null;
    };
    r.rpm = await read(0x0c, (d) => ((d[0] << 8) + d[1]) / 4);
    r.coolantF = await read(0x05, (d) => Math.round((d[0] - 40) * 9 / 5 + 32));
    r.fuelPct = await read(0x2f, (d) => Math.round(d[0] * 100 / 255));
    r.moduleVoltage = await read(0x42, (d) => ((d[0] << 8) + d[1]) / 1000);
    r.milDistanceMi = await read(0x21, (d) => kmToMi((d[0] << 8) + d[1]));
    r.warmupsSinceClear = await read(0x30, (d) => d[0]);
    r.distSinceClearMi = await read(0x31, (d) => kmToMi((d[0] << 8) + d[1]));
    r.milMinutes = await read(0x4d, (d) => (d[0] << 8) + d[1]);
    r.minutesSinceClear = await read(0x4e, (d) => (d[0] << 8) + d[1]);
    r.odometerMi = await read(0xa6, (d) => kmToMi(((d[0] << 24) >>> 0) + (d[1] << 16) + (d[2] << 8) + d[3]) / 10);
    r.odometerSource = r.odometerMi ? 'standard' : null;
    r.engineRunning = r.rpm != null ? r.rpm > 400 : null;
    if (!r.vinValid || !r.odometerMi) await engineComputerIds(elm, r, progress);
    return r;
  }

  // Ford-family VINs (Ford, Lincoln, Mercury trucks/SUVs/cars built in US, Canada, Mexico)
  function isFordVin(vin) { return /^(?:[1-3]F|[1-5]L|NM0|MAJ)/.test(vin || ''); }

  // Backup reads straight from the engine computer (7E0) on CAN trucks:
  //  - VIN via UDS 22 F190 when the standard VIN read failed
  //  - Ford: odometer via 22 DD01 (km, 3 bytes) when the standard odometer (PID A6) isn't supported
  async function engineComputerIds(elm, r, progress) {
    if (elm.protocol && !/^[6-9]$/.test(elm.protocol)) return;
    const wantVin = !r.vinValid, wantOdo = !r.odometerMi;
    if (!wantVin && !(wantOdo && isFordVin(r.vin))) return;
    progress(wantVin ? 'Reading the VIN from the engine computer' : 'Reading mileage from the engine computer');
    try {
      for (const c of ['ATSH7E0', 'ATCRA7E8', 'ATFCSH7E0', 'ATFCSD300000', 'ATFCSM1']) { try { await elm.send(c, 2000); } catch (e) {} }
      if (wantVin) {
        try {
          const msgs = parseMessages(await elm.send('22F190', 4000), true);
          const m = msgs.find((b) => b[0] === 0x62 && b[1] === 0xf1 && b[2] === 0x90);
          if (m) {
            const v = m.slice(3).map((b) => String.fromCharCode(b)).filter((c) => VIN_CHARS.test(c)).join('');
            if (v.length >= 17 && vinCheckOk(v.slice(-17))) { r.vin = v.slice(-17); r.vinValid = true; r.vinSource = 'engine computer'; }
          }
        } catch (e) { r.errors.push('22F190: ' + e.message); }
      }
      if (!r.odometerMi && isFordVin(r.vin)) {
        try {
          const msgs = parseMessages(await elm.send('22DD01', 4000), true);
          const m = msgs.find((b) => b[0] === 0x62 && b[1] === 0xdd && b[2] === 0x01);
          if (m && m.length >= 6) {
            const mi = kmToMi((m[3] << 16) + (m[4] << 8) + m[5]);
            if (mi > 0 && mi < 1000000) { r.odometerMi = mi; r.odometerSource = 'Ford engine computer'; }
          }
        } catch (e) { r.errors.push('22DD01: ' + e.message); }
      }
    } finally {
      for (const c of ['ATAR', 'ATFCSM0', 'ATSH7DF']) { try { await elm.send(c, 2000); } catch (e) {} }
    }
  }


  /* ---------- Idle check: RPM steadiness, fuel trims, per-cylinder misfire counters ---------- */

  // Mode 06 (CAN): records of [MID, TID, unit, valH, valL, minH, minL, maxH, maxL] after the 0x46
  function parseMode06(msgs, mid) {
    const out = {};
    for (const m of msgs) {
      if (m[0] !== 0x46) continue;
      const body = m.slice(1);
      for (let i = 0; i + 8 < body.length + 0; i += 9) {
        if (body[i] !== mid) continue;
        out[body[i + 1]] = (body[i + 3] << 8) | body[i + 4];
      }
    }
    return out;
  }

  async function idleCheck(elm, opts = {}) {
    const seconds = opts.seconds || 30;
    const onSample = opts.onSample || (() => {});
    const supported = new Set(opts.supported || []);
    const r = { at: new Date().toISOString(), rpm: [], stft1: [], stft2: [], ltft1: null, ltft2: null, timing: [], coolantF: null, misfires: null, errors: [] };
    const q = async (cmd, t) => { try { return parseMessages(await elm.send(cmd, t || 3000), elm.isCan); } catch (e) { r.errors.push(cmd + ': ' + e.message); return []; } };
    const get = async (pid) => pidData(await q('01' + hex2(pid)), pid);

    const c = await get(0x05); if (c) r.coolantF = Math.round((c[0] - 40) * 9 / 5 + 32);
    const l1 = await get(0x07); if (l1) r.ltft1 = trim(l1[0]);
    const l2 = supported.has(0x09) || !supported.size ? await get(0x09) : null; if (l2) r.ltft2 = trim(l2[0]);

    // Sample RPM as fast as the adapter allows, with one other reading rotated in between
    const extras = [[0x06, (d) => r.stft1.push(trim(d[0]))], [0x08, (d) => r.stft2.push(trim(d[0]))], [0x0e, (d) => r.timing.push(d[0] / 2 - 64)]]
      .filter(([pid]) => !supported.size || supported.has(pid));
    const end = Date.now() + seconds * 1000; let k = 0;
    while (Date.now() < end && !(opts.signal && opts.signal.aborted)) {
      const d = await get(0x0c);
      if (d) { const rpm = ((d[0] << 8) + d[1]) / 4; r.rpm.push({ t: Date.now(), rpm }); onSample(rpm, 1 - (end - Date.now()) / (seconds * 1000)); }
      if (extras.length) { const [pid, fn] = extras[k++ % extras.length]; const e = await get(pid); if (e) fn(e); }
    }

    // Engine computer's own misfire counters, per cylinder (CAN trucks, roughly 2008 and newer)
    if (elm.isCan) {
      const supMsgs = await q('06A0', 4000);
      const sm = supMsgs.find((m) => m[0] === 0x46 && m[1] === 0xa0);
      if (sm) {
        const cyls = [];
        const bits = sm.slice(2, 6);
        for (let cyl = 1; cyl <= 12; cyl++) {
          const mid = 0xa1 + cyl;
          const n = mid - 0xa1; // bit index for MID A2.. from A1
          const byte = bits[Math.floor(n / 8)], bit = 0x80 >> (n % 8);
          if (byte & bit) {
            const vals = parseMode06(await q('06' + hex2(mid), 4000), mid);
            if (vals[0x0b] !== undefined || vals[0x0c] !== undefined) cyls.push({ cyl, avg10: vals[0x0b] ?? null, lastTrip: vals[0x0c] ?? null });
          }
        }
        if (cyls.length) r.misfires = cyls;
      }
    }
    return r;
  }
  const trim = (b) => Math.round(((b - 128) * 100 / 128) * 10) / 10;

  // opts.codes: stored + pending codes from the scan, so a misfire code and the counters agree
  function assessIdle(r, opts) {
    const F = [];
    const add = (level, title, detail) => F.push({ level, title, detail: detail || '' });
    const rpms = r.rpm.map((s) => s.rpm).filter((x) => x > 0);
    if (rpms.length < 10) {
      add('watch', 'Idle check incomplete', rpms.length ? 'Too few RPM readings. Try again.' : 'Engine doesn’t appear to be running.');
      return { overall: 'watch', findings: F, stats: null };
    }
    const mean = rpms.reduce((a, b) => a + b, 0) / rpms.length;
    const sd = Math.sqrt(rpms.reduce((a, b) => a + (b - mean) ** 2, 0) / rpms.length);
    const dips = rpms.filter((x) => x < mean - 50).length;
    const stats = { mean: Math.round(mean), sd: Math.round(sd), min: Math.round(Math.min(...rpms)), max: Math.round(Math.max(...rpms)), samples: rpms.length, dips };
    const cold = r.coolantF != null && r.coolantF < 160;
    if (cold) add('watch', 'Engine not warmed up (' + r.coolantF + '°F)', 'Idle and fuel trims read best at full operating temp. Rescan once warm for a firm answer.');

    if (sd > 40 || dips >= Math.max(3, rpms.length * 0.08)) add('problem', 'Rough idle: RPM swinging ±' + Math.round(sd) + ' (' + stats.min + '–' + stats.max + ')', 'Repeated stumbles of 50+ RPM. Typical causes: misfire (plugs, coils, injector), vacuum leak, dirty throttle body.');
    else if (sd > 20 || dips >= 2) add('watch', 'Slightly unsteady idle: ±' + Math.round(sd) + ' RPM', 'Worth a closer listen. Often plugs/coils or a dirty throttle body.');
    else add('good', 'Steady idle: ' + stats.mean + ' RPM (±' + Math.round(sd) + ')', '');
    if (!cold && mean > 1000) add('watch', 'High idle: ' + stats.mean + ' RPM when warm', 'Possible vacuum leak or idle control problem.');

    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const banks = [[avg(r.stft1), r.ltft1, 'bank 1'], [avg(r.stft2), r.ltft2, 'bank 2']];
    for (const [st, lt, name] of banks) {
      if (st == null && lt == null) continue;
      const total = Math.round(((st || 0) + (lt || 0)) * 10) / 10;
      const desc = 'Short-term ' + fmtPct(st) + ', long-term ' + fmtPct(lt) + '.';
      if (total > 20) add('problem', 'Running lean, ' + name + ': fuel trim ' + fmtPct(total), desc + ' Computer is adding a lot of fuel. Look for vacuum leaks, dirty MAF, weak fuel pump or clogged injectors.');
      else if (total > 10) add('watch', 'Slightly lean, ' + name + ': fuel trim ' + fmtPct(total), desc + ' Check for vacuum leaks and clean the MAF.');
      else if (total < -20) add('problem', 'Running rich, ' + name + ': fuel trim ' + fmtPct(total), desc + ' Leaking injector, high fuel pressure or bad O2/MAF sensor.');
      else if (total < -10) add('watch', 'Slightly rich, ' + name + ': fuel trim ' + fmtPct(total), desc);
      else add('good', 'Fuel trim normal, ' + name + ': ' + fmtPct(total), desc);
    }

    /* Misfires. Every engine logs a few now and then (cold starts, bad fuel, a pothole), so a handful is normal.
       What matters is an ACTIVE misfire: one cylinder clearly worse than the rest on the current trip, or a
       misfire code. That's when to buy plugs and coils. The engine keeps two counters per cylinder (Mode 06):
       this trip (lastTrip) and an average of the last 10 trips (avg10). */
    const codes = (opts && opts.codes) || [];
    const misCodes = codes.filter((c) => /^P03(0[1-9]|1[0-2])$/.test(c));
    const codeCyls = misCodes.map((c) => +c.slice(3));
    if (r.misfires && r.misfires.length) {
      const counts = r.misfires.map((m) => ({ cyl: m.cyl, trip: m.lastTrip || 0, avg: m.avg10 || 0 }));
      const med = (k) => { const s = counts.map((c) => c[k]).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
      const mTrip = med('trip'), mAvg = med('avg');
      const stands = (n, m) => n > 3 * Math.max(m, 3);
      const active = counts.filter((c) => codeCyls.includes(c.cyl) || (c.trip >= 30 && stands(c.trip, mTrip)) || (c.avg >= 50 && c.trip >= 10 && stands(c.avg, mAvg)));
      const history = counts.filter((c) => !active.includes(c) && c.avg >= 20 && stands(c.avg, mAvg));
      const show = (list) => list.map((c) => 'Cyl ' + c.cyl + ': ' + c.trip + ' this trip, ' + c.avg + ' average').join('; ');
      const total = counts.reduce((s, c) => s + c.trip, 0);
      if (active.length) add('problem', 'Active misfire on cylinder ' + active.map((c) => c.cyl).join(', '), show(active) + ' (other cylinders around ' + mTrip + '). This one needs fixing: plan on the plug and coil' + (active.length > 1 ? 's' : '') + '. Swap the coil to another cylinder first to see if the misfire follows it.');
      else if (history.length) add('watch', 'Past misfires on cylinder ' + history.map((c) => c.cyl).join(', '), show(history) + '. Not misfiring much right now. Check that plug and coil at the next service; no parts needed yet.');
      else add('good', total ? 'Only occasional misfires (normal)' : 'No misfires counted', total ? total + ' misfires this trip spread across ' + counts.length + ' cylinders, no cylinder standing out. Every engine logs a few.' : counts.length + ' cylinders checked.');
    } else if (misCodes.length) {
      add('problem', 'Active misfire on cylinder ' + codeCyls.join(', '), 'From the misfire code' + (misCodes.length > 1 ? 's' : '') + ' (' + misCodes.join(', ') + '). Plan on the plug and coil.');
    } else {
      add('good', 'Per-cylinder misfire counters not available', 'This truck doesn’t share them over the generic port, so the idle RPM above and any misfire codes are the guide.');
      F[F.length - 1].level = 'info';
    }

    for (const f of F) {
      if (f.level === 'good' || f.level === 'info') continue;
      if (/Active misfire|Rough idle/i.test(f.title)) f.parts = ['spark plugs', 'ignition coil'];
      else if (/lean/i.test(f.title)) f.parts = ['air intake boot', 'PCV valve', 'MAF sensor cleaner'];
      else if (/rich/i.test(f.title)) f.parts = ['mass air flow sensor', 'oxygen sensor'];
      else if (/High idle/i.test(f.title)) f.parts = ['throttle body cleaner'];
    }
    const order = { problem: 0, watch: 1, good: 2, info: 3 };
    F.sort((a, b) => order[a.level] - order[b.level]);
    const overall = F.some((f) => f.level === 'problem') ? 'problem' : F.some((f) => f.level === 'watch') ? 'watch' : 'good';
    if (F.some((f) => f.level === 'problem' && /Active misfire|Rough idle/.test(f.title))) {
      F.push({ level: 'info', title: 'Tune-up suggested', detail: 'Plugs and coil/boot inspection, throttle body and MAF cleaning, then rescan.' });
    }
    return { overall, findings: F, stats };
  }
  const fmtPct = (v) => v == null ? 'n/a' : (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) + '%';

  /* ---------- Freeze frame: conditions when the check engine light set ---------- */
  async function freezeFrame(elm) {
    const q = async (pid) => {
      try {
        const msgs = parseMessages(await elm.send('02' + hex2(pid) + '00', 3000), elm.isCan);
        const m = msgs.find((b) => b[0] === 0x42 && b[1] === pid);
        return m ? m.slice(3) : null;
      } catch (e) { return null; }
    };
    const d = await q(0x02);
    if (!d || d.length < 2 || (!d[0] && !d[1])) return null;
    const ff = { code: decodeDtc(d[0], d[1]) };
    const v = async (pid, fn) => { const x = await q(pid); return x && x.length ? fn(x) : null; };
    ff.rpm = await v(0x0c, (x) => Math.round(((x[0] << 8) + x[1]) / 4));
    ff.mph = await v(0x0d, (x) => Math.round(x[0] * 0.621371));
    ff.coolantF = await v(0x05, (x) => Math.round((x[0] - 40) * 9 / 5 + 32));
    ff.loadPct = await v(0x04, (x) => Math.round(x[0] * 100 / 255));
    ff.stft = await v(0x06, (x) => trim(x[0]));
    ff.ltft = await v(0x07, (x) => trim(x[0]));
    ff.throttlePct = await v(0x11, (x) => Math.round(x[0] * 100 / 255));
    return ff;
  }
  function describeFreeze(ff) {
    if (!ff) return '';
    const bits = [];
    if (ff.mph != null) bits.push(ff.mph ? ff.mph + ' mph' : 'stopped/idling');
    if (ff.rpm != null) bits.push(ff.rpm.toLocaleString() + ' RPM');
    if (ff.coolantF != null) bits.push(ff.coolantF + '°F engine');
    if (ff.loadPct != null) bits.push(ff.loadPct + '% load');
    if (ff.stft != null || ff.ltft != null) bits.push('fuel trim ' + fmtPct((ff.stft || 0) + (ff.ltft || 0)));
    return 'When ' + ff.code + ' set: ' + bits.join(', ') + '.';
  }

  /* ---------- Module codes (airbag, ABS, transmission, body) over UDS. Ford first; CAN 11-bit 500k only ---------- */
  const MODULES = {
    ford: [
      ['PCM', 'Engine computer', 0x7e0], ['TCM', 'Transmission', 0x7e1], ['ABS', 'ABS / brakes', 0x760],
      ['RCM', 'Airbag', 0x737], ['OCSM', 'Passenger airbag sensor', 0x765], ['PSCM', 'Power steering', 0x730],
      ['IPC', 'Instrument cluster', 0x720], ['BCM', 'Body', 0x726], ['GWM', 'Gateway', 0x716], ['TCCM', '4x4 / transfer case', 0x761]
    ]
  };
  function makeFamily(make) {
    if (/ford|lincoln|mercury/i.test(make || '')) return 'ford';
    return null;
  }
  async function moduleScan(elm, make, progress = () => {}) {
    const fam = makeFamily(make);
    const out = { family: fam, modules: [], note: '' };
    if (!fam) { out.note = 'Module scan for ' + (make || 'this make') + ' isn’t set up yet (Ford first).'; return out; }
    if (elm.protocol && elm.protocol !== '6') { out.note = 'This truck uses a network the module scan doesn’t support yet.'; return out; }
    try {
      for (const c of ['ATSP6', 'ATAT1', 'ATST64', 'ATFCSD300000', 'ATFCSM1']) await elm.send(c, 2000);
      for (const [abbr, name, tx] of MODULES[fam]) {
        progress('Reading ' + name.toLowerCase() + ' module');
        const rx = tx + 8;
        const mod = { abbr, name, present: false, codes: [] };
        try {
          await elm.send('ATSH' + tx.toString(16).toUpperCase(), 2000);
          await elm.send('ATCRA' + rx.toString(16).toUpperCase(), 2000);
          await elm.send('ATFCSH' + tx.toString(16).toUpperCase(), 2000);
          const lines = await elm.send('19028F', 4000);
          const msgs = parseMessages(lines, true);
          const m = msgs.find((b) => b[0] === 0x59 && b[1] === 0x02);
          if (m) {
            mod.present = true;
            const body = m.slice(3);
            for (let i = 0; i + 3 < body.length; i += 4) {
              const base = decodeDtc(body[i], body[i + 1]);
              if (!base) continue;
              const st = body[i + 3];
              if (!(st & 0x09)) continue; // only failing now or confirmed
              mod.codes.push({ code: base + '-' + hex2(body[i + 2]), base, active: !!(st & 0x01), confirmed: !!(st & 0x08) });
            }
          } else if (msgs.some((b) => b[0] === 0x7f)) mod.present = true;
        } catch (e) { /* module didn't answer */ }
        if (mod.present) out.modules.push(mod);
      }
    } finally {
      for (const c of ['ATAR', 'ATFCSM0', 'ATSH7DF', 'ATST96', 'ATSP0']) { try { await elm.send(c, 2000); } catch (e) {} }
      try { await elm.send('0100', 15000); } catch (e) {}
    }
    return out;
  }
  function assessModules(ms) {
    const F = [];
    if (!ms) return F;
    if (ms.note) { F.push({ level: 'info', title: 'Module codes not read', detail: ms.note }); return F; }
    if (!ms.modules.length) { F.push({ level: 'info', title: 'No modules answered', detail: 'Airbag/ABS modules may sit on a network this adapter can’t reach.' }); return F; }
    for (const m of ms.modules) {
      for (const c of m.codes) {
        const airbag = /Airbag/.test(m.name);
        const level = airbag || (/ABS|Transmission|steering/i.test(m.name) && c.active) ? 'problem' : 'watch';
        F.push({ level, title: m.name + ': ' + c.code + (c.active ? ' (active now)' : ' (stored)'),
          detail: airbag ? 'Airbag fault. Must be fixed before sale.' : (c.active ? 'Fault present right now.' : 'Happened before; may be old.'),
          moduleCode: c.base, module: m.name });
      }
    }
    const clean = ms.modules.filter((m) => !m.codes.length).map((m) => m.abbr);
    if (clean.length) F.push({ level: 'good', title: 'No codes in ' + clean.join(', '), detail: ms.modules.length + ' modules answered.' });
    return F;
  }
  const MODULE_FIX = {
    'Airbag': ['Diagnose the airbag fault (seat belt buckles, clock spring, seat connectors are most common). Must be fixed before sale.', ['clock spring'], '$$', [60, 300]],
    'Passenger airbag sensor': ['Check the passenger seat sensor and connector under the seat.', ['occupant classification sensor'], '$$', [80, 400]],
    'ABS / brakes': ['Most often a wheel speed sensor or its wiring. Check which wheel from the code.', ['ABS wheel speed sensor'], '$', [25, 150]],
    'Transmission': ['Check fluid level and condition; transmission shop to diagnose if active.', ['transmission fluid'], '$$', [60, 800]],
    'Power steering': ['Check battery voltage and the steering angle calibration; shop to diagnose if active.', [], '$$', [100, 500]],
    '4x4 / transfer case': ['Test 4x4 engagement; check the encoder motor and front axle actuator.', ['transfer case shift motor'], '$$', [80, 350]],
    'Engine computer': ['See the matching engine code above, if any.', [], '', [0, 0]]
  };
  function moduleFix(moduleName) {
    const f = MODULE_FIX[moduleName] || ['Diagnose with a full scan tool before buying parts.', [], '$', [50, 200]];
    return { fix: f[0], parts: f[1], tier: f[2], tierWord: TIER_WORD[f[2]] || '', range: f[3] };
  }

  /* ---------- Test drive recorder ---------- */
  async function driveLog(elm, opts = {}) {
    const onSample = opts.onSample || (() => {});
    const supported = new Set(opts.supported || []);
    const S = []; const r = { start: new Date().toISOString(), samples: S, errors: [] };
    const get = async (pid) => { try { return pidData(parseMessages(await elm.send('01' + hex2(pid), 2000), elm.isCan), pid); } catch (e) { return null; } };
    const extras = [[0x05, 'coolantF', (d) => Math.round((d[0] - 40) * 9 / 5 + 32)], [0x04, 'load', (d) => Math.round(d[0] * 100 / 255)], [0x11, 'throttle', (d) => Math.round(d[0] * 100 / 255)]]
      .filter(([pid]) => !supported.size || supported.has(pid));
    let k = 0;
    while (!(opts.signal && opts.signal.aborted)) {
      const s = { t: Date.now() };
      const sp = await get(0x0d); if (sp) s.mph = sp[0] * 0.621371;
      const rp = await get(0x0c); if (rp) s.rpm = ((rp[0] << 8) + rp[1]) / 4;
      if (extras.length) { const [pid, key, fn] = extras[k++ % extras.length]; const d = await get(pid); if (d) s[key] = fn(d); }
      if (s.mph != null || s.rpm != null) { S.push(s); onSample(s, S); }
      if (S.length > 20000) break;
    }
    r.end = new Date().toISOString();
    return r;
  }
  async function afterDrive(elm) {
    const q = async (cmd) => { try { return parseMessages(await elm.send(cmd, 8000), elm.isCan); } catch (e) { return []; } };
    return { stored: parseDtcs(await q('03'), 0x43, elm.isCan), pending: parseDtcs(await q('07'), 0x47, elm.isCan) };
  }
  // opts.lane: a short auction-lane drive (about 300 m, up to 35-45 mph) instead of a full road test
  function assessDrive(r, before, after, opts) {
    const lane = !!(opts && opts.lane);
    const S = r.samples.filter((s) => s.mph != null);
    const F = []; const add = (level, title, detail, parts) => F.push({ level, title, detail: detail || '', parts });
    if (lane && (S.length < 12 || Math.max(...S.map((s) => s.mph)) < 15)) return { overall: 'watch', findings: [{ level: 'watch', title: 'Drive too short to judge', detail: 'Accelerate firmly from a stop to at least 30 mph so it shifts a couple of times.' }], stats: null };
    if (!lane && S.length < 20) return { overall: 'watch', findings: [{ level: 'watch', title: 'Test drive too short to judge', detail: 'Drive at least 10 minutes, town and highway.' }], stats: null };
    /* Shift flares. A slipping shift shows as RPM jumping without the truck speeding up, then dropping back
       when the gear finally grabs. A downshift also jumps RPM, but it stays up, so it isn't counted.
       Modern 8- and 10-speeds (2017+ F-150 10R80 and the like) shift fast and often blip RPM a few hundred on a
       shift without anything wrong, so they get more room. Only big, repeated flares count as slipping on their
       own; anything smaller asks the driver whether it felt like it slipped (opts.felt, set by the app). */
    const gears = (opts && +opts.gears) || 0, many = gears >= 8;
    const minJump = many ? 500 : 350, bigJump = many ? 900 : 700;
    let miles = 0, maxMph = 0, maxF = null, flares = 0, big = 0, worst = 0, harsh = 0;
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i], dt = (b.t - a.t) / 3600000;
      miles += ((a.mph + b.mph) / 2) * dt; maxMph = Math.max(maxMph, b.mph);
      if (b.rpm != null && a.rpm != null && b.mph > 10 && b.mph >= a.mph - 1 && b.mph - a.mph < 3 && b.rpm - a.rpm > minJump && (b.t - a.t) < 1500) {
        // came back down within ~2.5 s (a flare), or stayed up (a downshift)?
        let back = false;
        for (let j = i + 1; j < S.length && S[j].t - b.t < 2500; j++) if (S[j].rpm != null && S[j].rpm < a.rpm + 150) { back = true; break; }
        if (back) { const jump = b.rpm - a.rpm; flares++; worst = Math.max(worst, jump); if (jump > bigJump) big++; }
      }
      if (a.mph - b.mph > 8 && (b.t - a.t) < 1500) harsh++;
    }
    r.samples.forEach((s) => { if (s.coolantF != null) maxF = Math.max(maxF || 0, s.coolantF); });
    // Steady cruise RPM wobble (torque converter shudder / slip)
    const cruise = []; let win = [];
    for (const s of S) {
      if (s.mph > 40 && s.rpm != null) { win.push(s); if (win.length > 8) win.shift();
        if (win.length === 8 && Math.max(...win.map((x) => x.mph)) - Math.min(...win.map((x) => x.mph)) < 2) {
          const rp = win.map((x) => x.rpm), mean = rp.reduce((x, y) => x + y, 0) / rp.length;
          cruise.push(Math.sqrt(rp.reduce((x, y) => x + (y - mean) ** 2, 0) / rp.length));
        }
      } else win = [];
    }
    const cruiseWobble = cruise.length ? cruise.reduce((x, y) => x + y, 0) / cruise.length : null;
    const minutes = Math.round((S[S.length - 1].t - S[0].t) / 60000);
    const stats = { miles: Math.round(miles * 10) / 10, minutes, maxMph: Math.round(maxMph), maxF, flares, bigFlares: big, worstFlare: Math.round(worst), gears: gears || null, cruiseWobble: cruiseWobble == null ? null : Math.round(cruiseWobble) };

    const felt = opts && opts.felt;
    const tenNote = many ? ' Common on ' + gears + '-speed automatics.' : ' Fast modern automatics (8- and 10-speeds) often do this.';
    const howMany = flares + ' time' + (flares > 1 ? 's' : '') + ' (biggest ' + Math.round(worst) + ' RPM)';
    if (!flares) add('good', 'Shifts looked clean', 'No RPM flares while accelerating.');
    else if (felt === 'yes') add('problem', 'Slipping felt on shifts; RPM flared ' + howMany, 'You felt it slip, and the RPM backs that up. Transmission shop should look at it.', ['transmission fluid']);
    else if (big >= 3 && flares >= 5) add('problem', 'Big RPM flares on shifts: ' + howMany, 'Repeated large jumps that dropped back, a sign of slipping shifts. If it felt fine, try a fluid check and an adaptive relearn, then drive it again.', ['transmission fluid']);
    else if (felt === 'no') add('good', 'Small RPM blips on shifts, no slip felt', 'RPM blipped ' + howMany + ' and the driver felt no slipping.' + tenNote);
    else add('watch', 'RPM blipped on shifts ' + howMany, 'Short blips on a shift are usually normal.' + tenNote + ' Only a problem if you felt it slip or flare. Answer below.');
    if (flares) F[F.length - 1].flare = true;
    if (cruiseWobble != null) {
      if (cruiseWobble > 60) add('problem', 'RPM wavering at steady highway speed', 'Typical of torque converter shudder or slip. Did you feel a rumble like driving over rumble strips?', ['transmission fluid']);
      else if (cruiseWobble > 35) add('watch', 'Slight RPM wander at cruise', 'Recheck with cruise control on a flat road.');
      else add('good', 'Steady at highway speed', '');
    } else if (lane) add('info', 'Torque converter shudder not checked', 'Needs a steady 40+ mph, which a short lane won\u2019t allow. On light throttle at 30\u201340 mph, feel for a rumble like driving over rumble strips.');
    else add('info', 'No steady cruise above 40 mph recorded', 'Hold a steady 45\u201365 mph for 30 seconds to check the torque converter.');
    if (maxF != null) {
      if (maxF > 230) add('problem', 'Ran hot: ' + maxF + '°F', 'Check coolant, fan, thermostat and radiator.', ['thermostat', 'coolant']);
      else if (maxF < 180 && minutes >= 10) add('watch', 'Never fully warmed up: ' + maxF + '°F max', 'Thermostat may be stuck open.', ['thermostat']);
      else add('good', 'Engine temp normal: ' + maxF + '°F max', '');
    }
    if (after) {
      const had = new Set([...(before.stored || []), ...(before.pending || [])]);
      const fresh = [...after.stored, ...after.pending].filter((c) => !had.has(c));
      if (fresh.length) fresh.forEach((c) => F.push({ level: codeSeverity(c), title: 'New during drive: ' + c + ' — ' + describeCode(c), detail: 'Showed up on the test drive.', code: c }));
      else add('good', 'No new codes after the drive', '');
    }
    const order = { problem: 0, watch: 1, good: 2, info: 3 };
    F.sort((a, b) => order[a.level] - order[b.level]);
    const overall = F.some((f) => f.level === 'problem') ? 'problem' : F.some((f) => f.level === 'watch') ? 'watch' : 'good';
    return { overall, findings: F, stats };
  }

  /* ---------- Trouble code library (plain words) ---------- */

  const CODES = {
    P0010:'Camshaft timing actuator circuit (bank 1)',P0011:'Camshaft timing over-advanced (bank 1)',P0012:'Camshaft timing over-retarded (bank 1)',
    P0014:'Exhaust camshaft timing over-advanced (bank 1)',P0016:'Crankshaft / camshaft timing mismatch (bank 1, sensor A)',P0017:'Crankshaft / camshaft timing mismatch (bank 1, sensor B)',
    P0018:'Crankshaft / camshaft timing mismatch (bank 2, sensor A)',P0019:'Crankshaft / camshaft timing mismatch (bank 2, sensor B)',P0021:'Camshaft timing over-advanced (bank 2)',
    P0030:'O2 sensor heater circuit (bank 1, sensor 1)',P0036:'O2 sensor heater circuit (bank 1, sensor 2)',P0046:'Turbo boost control circuit',
    P0068:'Air flow and throttle position don’t agree',P0069:'Manifold pressure and barometric pressure don’t agree',
    P0087:'Fuel rail pressure too low',P0088:'Fuel rail pressure too high',P0093:'Large fuel system leak detected',
    P0101:'Mass air flow (MAF) sensor out of range',P0102:'Mass air flow (MAF) sensor reading low',P0103:'Mass air flow (MAF) sensor reading high',
    P0106:'Manifold pressure (MAP) sensor out of range',P0107:'Manifold pressure (MAP) sensor reading low',P0108:'Manifold pressure (MAP) sensor reading high',
    P0112:'Intake air temp sensor reading low',P0113:'Intake air temp sensor reading high',P0116:'Coolant temp sensor out of range',
    P0117:'Coolant temp sensor reading low',P0118:'Coolant temp sensor reading high',P0121:'Throttle position sensor out of range',
    P0122:'Throttle position sensor reading low',P0123:'Throttle position sensor reading high',P0125:'Engine slow to warm up enough for fuel control',
    P0128:'Engine running cool, likely stuck-open thermostat',P0131:'O2 sensor low voltage (bank 1, sensor 1)',P0133:'O2 sensor slow response (bank 1, sensor 1)',
    P0134:'O2 sensor no activity (bank 1, sensor 1)',P0135:'O2 sensor heater circuit (bank 1, sensor 1)',P0136:'O2 sensor circuit (bank 1, sensor 2)',
    P0137:'O2 sensor low voltage (bank 1, sensor 2)',P0138:'O2 sensor high voltage (bank 1, sensor 2)',P0139:'O2 sensor slow response (bank 1, sensor 2)',
    P0141:'O2 sensor heater circuit (bank 1, sensor 2)',P0151:'O2 sensor low voltage (bank 2, sensor 1)',P0153:'O2 sensor slow response (bank 2, sensor 1)',
    P0155:'O2 sensor heater circuit (bank 2, sensor 1)',P0161:'O2 sensor heater circuit (bank 2, sensor 2)',
    P0171:'Running lean (bank 1): vacuum leak, MAF or fuel delivery',P0172:'Running rich (bank 1)',P0174:'Running lean (bank 2): vacuum leak, MAF or fuel delivery',P0175:'Running rich (bank 2)',
    P0191:'Fuel rail pressure sensor out of range',P0217:'Engine overheating',P0220:'Throttle position sensor B circuit',
    P0234:'Turbo overboost',P0238:'Boost sensor reading high',P0299:'Turbo underboost (low boost)',
    P0300:'Random misfire, more than one cylinder',P0316:'Misfire at startup',P0325:'Knock sensor circuit (bank 1)',P0330:'Knock sensor circuit (bank 2)',
    P0335:'Crankshaft position sensor circuit',P0340:'Camshaft position sensor circuit (bank 1)',P0345:'Camshaft position sensor circuit (bank 2)',
    P0380:'Glow plug circuit',P0400:'EGR flow problem',P0401:'EGR flow too low',P0402:'EGR flow too high',P0403:'EGR control circuit',P0404:'EGR out of range',
    P0410:'Secondary air injection system',P0411:'Secondary air injection flow incorrect',
    P0420:'Catalytic converter efficiency low (bank 1)',P0430:'Catalytic converter efficiency low (bank 2)',
    P0440:'EVAP (fuel vapor) system fault',P0441:'EVAP purge flow incorrect',P0442:'EVAP small leak',P0443:'EVAP purge valve circuit',
    P0446:'EVAP vent control circuit',P0449:'EVAP vent valve circuit',P0451:'EVAP pressure sensor out of range',P0452:'EVAP pressure sensor reading low',
    P0453:'EVAP pressure sensor reading high',P0455:'EVAP large leak (check gas cap first)',P0456:'EVAP very small leak',P0457:'EVAP leak: gas cap loose or missing',
    P0461:'Fuel level sensor out of range',P0463:'Fuel level sensor reading high',P0471:'Exhaust pressure sensor out of range',P0480:'Cooling fan control circuit',
    P0491:'Secondary air injection (bank 1)',P0496:'EVAP purge flow too high',P0500:'Vehicle speed sensor',P0505:'Idle control system',
    P0506:'Idle speed lower than expected',P0507:'Idle speed higher than expected',P0520:'Oil pressure sensor circuit',P0521:'Oil pressure sensor out of range',
    P0524:'Engine oil pressure too low',P0562:'System voltage low',P0563:'System voltage high',P0571:'Brake switch circuit',
    P0600:'Computer communication link fault',P0601:'Engine computer memory error',P0603:'Engine computer memory reset',P0606:'Engine computer processor fault',
    P0607:'Control module performance',P0620:'Alternator control circuit',P0625:'Alternator field circuit low',P0641:'Sensor reference voltage A',P0651:'Sensor reference voltage B',
    P0700:'Transmission computer has stored a code (scan the TCM)',P0705:'Transmission range (PRNDL) sensor',P0710:'Transmission fluid temp sensor circuit',
    P0711:'Transmission fluid temp sensor out of range',P0715:'Transmission input speed sensor',P0720:'Transmission output speed sensor',
    P0730:'Transmission incorrect gear ratio',P0731:'Transmission slipping in 1st gear',P0732:'Transmission slipping in 2nd gear',P0733:'Transmission slipping in 3rd gear',
    P0734:'Transmission slipping in 4th gear',P0735:'Transmission slipping in 5th gear',P0736:'Transmission incorrect ratio in reverse',
    P0740:'Torque converter clutch circuit',P0741:'Torque converter clutch slipping / stuck off',P0742:'Torque converter clutch stuck on',P0743:'Torque converter clutch solenoid electrical',
    P0748:'Transmission pressure control solenoid electrical',P0750:'Shift solenoid A',P0755:'Shift solenoid B',P0760:'Shift solenoid C',P0765:'Shift solenoid D',P0770:'Shift solenoid E',
    P0776:'Transmission pressure control solenoid B stuck off',P0868:'Transmission fluid pressure low',P0882:'Transmission computer power low',
    P1000:'Self-tests not finished since last reset (Ford): codes may have been cleared',
    P2002:'Diesel particulate filter efficiency low',P2096:'Fuel trim after catalyst too lean (bank 1)',P2097:'Fuel trim after catalyst too rich (bank 1)',
    P2135:'Throttle / pedal position sensors disagree',P2187:'Running lean at idle (bank 1)',P2195:'O2 sensor stuck lean (bank 1)',P2196:'O2 sensor stuck rich (bank 1)',
    P2263:'Turbo boost system performance',P2279:'Intake air leak',P2453:'DPF pressure sensor out of range',P2463:'Diesel particulate filter soot buildup',
    P20EE:'SCR / NOx catalyst efficiency low (diesel)',
    U0001:'High-speed network fault',U0073:'Network bus off',U0100:'Lost communication with engine computer',U0101:'Lost communication with transmission computer',
    U0121:'Lost communication with ABS module',U0140:'Lost communication with body control module',U0155:'Lost communication with instrument cluster'
  };
  for (let i = 1; i <= 12; i++) CODES['P03' + String(i).padStart(2, '0')] = 'Cylinder ' + i + ' misfire';
  for (let i = 1; i <= 8; i++) { CODES['P020' + i] = 'Fuel injector circuit, cylinder ' + i; CODES['P035' + i] = 'Ignition coil circuit, cylinder ' + i; }

  /* ---------- Likely fix + parts per code (first match wins). Tier: $ under $200, $$ $200-1,000, $$$ likely over $1,000.
     Ranges are what it usually costs LCC, not retail: parts at our price (Walmart, used/junkyard, RockAuto, Amazon) plus our own labor. ---------- */
  const FIXES = [
    [/^P1000$/, 'Not a fault. The truck needs a full drive cycle (town + highway) to finish its self-tests. Rescan after 50–100 mi.', [], '', [0, 0]],
    [/^P0300$/, 'Pull and check spark plugs and coils, look for vacuum leaks, check fuel trims in the idle check. On high miles, plugs are the first move.', ['spark plugs', 'ignition coil'], '$$', [120, 400]],
    [/^P03(0[1-9]|1[0-2])$/, 'Swap that cylinder’s coil with a neighbor and rescan. If the misfire moves, replace the coil. If not, replace the plug, then check the injector.', ['spark plug', 'ignition coil'], '$', [30, 120]],
    [/^P035[1-8]$/, 'Check the coil connector and wiring, then replace the coil.', ['ignition coil'], '$', [20, 80]],
    [/^P020[1-8]$/, 'Check the injector connector and wiring first, then replace the injector.', ['fuel injector'], '$', [60, 250]],
    [/^P0(171|174)$|^P2187$/, 'Smoke-test for vacuum leaks (intake boot, PCV hose, intake gasket), clean the MAF sensor, then check fuel pressure.', ['MAF sensor cleaner', 'air intake boot', 'PCV valve'], '$', [20, 150]],
    [/^P0(172|175)$/, 'Check for a leaking injector or high fuel pressure, clean or replace the MAF, check the upstream O2 sensor.', ['mass air flow sensor'], '$', [60, 250]],
    [/^P0(420|430)$/, 'Fix any misfire, exhaust leak or O2 sensor code first, then retest. If it returns, the catalytic converter is done.', ['catalytic converter', 'downstream oxygen sensor'], '$$', [300, 1200]],
    [/^P0(03\d|04\d|05\d|06[0-7]|13\d|14\d|15\d|16[0-7])$|^P219[5-8]$/, 'Replace the oxygen sensor named in the code (bank and sensor number). Check for exhaust leaks ahead of it.', ['oxygen sensor'], '$', [30, 120]],
    [/^P04(4\d|5\d)$|^P0496$/, 'Start with the gas cap (tighten or replace), then smoke-test the EVAP system. Purge and vent valves are common failures.', ['gas cap', 'EVAP purge valve', 'EVAP vent valve'], '$', [15, 150]],
    [/^P010[0-3]$/, 'Clean the MAF sensor and check the intake for leaks after it. Replace the sensor if the code returns.', ['mass air flow sensor'], '$', [15, 120]],
    [/^P010[5-8]$|^P0069$/, 'Check the MAP sensor vacuum line and connector, then replace the sensor.', ['MAP sensor'], '$', [25, 100]],
    [/^P011[0-4]$/, 'Check the connector, then replace the intake air temp sensor.', ['intake air temperature sensor'], '$', [15, 60]],
    [/^P011[5-9]$/, 'Check coolant level and the sensor connector, then replace the coolant temp sensor.', ['coolant temperature sensor'], '$', [20, 80]],
    [/^P012[58]$/, 'Thermostat is likely stuck open. Replace thermostat and refill coolant.', ['thermostat', 'coolant'], '$', [40, 150]],
    [/^P012[0-4]$|^P0220$|^P2135$|^P0068$/, 'Clean the throttle body and check its connector. Replace the throttle body if the code returns.', ['throttle body'], '$', [15, 250]],
    [/^P001[0-4]$|^P002[0-4]$/, 'Check oil level and that it’s the correct oil, then change it. If the code returns, replace the cam timing (VVT) solenoid.', ['engine oil and filter', 'variable valve timing solenoid'], '$', [40, 200]],
    [/^P001[6-9]$/, 'Crank and cam sensors disagree. Often a stretched timing chain on high-mileage trucks. Check oil, then have the shop verify chain stretch.', ['timing chain kit', 'camshaft position sensor'], '$$$', [800, 2500]],
    [/^P03(3[5-9])$|^P034[0-9]$/, 'Check the sensor connector and wiring, then replace the crank or cam sensor named in the code.', ['crankshaft position sensor', 'camshaft position sensor'], '$', [25, 120]],
    [/^P03(2[5-9]|3[0-4])$/, 'Check wiring, then replace the knock sensor (often under the intake on V engines).', ['knock sensor'], '$$', [60, 350]],
    [/^P040[0-9]$/, 'Clean or replace the EGR valve and clear carbon from the passages.', ['EGR valve'], '$$', [80, 300]],
    [/^P04(1\d)$|^P049[1-2]$/, 'Test the secondary air pump and check valves; replace the failed part.', ['secondary air injection pump', 'secondary air check valve'], '$$', [120, 450]],
    [/^P050[0-3]$/, 'Check wiring, then replace the vehicle speed sensor.', ['vehicle speed sensor'], '$', [25, 100]],
    [/^P050[5-9]$/, 'Clean the throttle body and check for vacuum leaks.', ['throttle body cleaner', 'idle air control valve'], '$', [15, 150]],
    [/^P052[0-4]$/, 'Verify oil level, then verify actual oil pressure with a mechanical gauge before driving. If pressure is good, replace the sensor.', ['oil pressure sensor'], '$', [20, 120]],
    [/^P05(6[0-3])$|^P06(2[0-5])$/, 'Load-test the battery and check the alternator output and cables.', ['alternator', 'battery'], '$$', [60, 300]],
    [/^P0700$/, 'The transmission computer has its own code. Scan it with a full scan tool and check fluid level and condition.', ['transmission fluid'], '$', [30, 150]],
    [/^P070[5-9]$/, 'Adjust or replace the transmission range sensor.', ['transmission range sensor'], '$$', [60, 250]],
    [/^P07(1\d|2\d)$/, 'Check wiring, then replace the transmission speed or temp sensor named in the code.', ['transmission speed sensor'], '$', [30, 150]],
    [/^P073\d$|^P0868$/, 'Transmission slipping. Check fluid level, color and smell. Likely internal: send to the transmission shop for a quote.', ['transmission fluid', 'transmission filter kit'], '$$$', [1200, 3500]],
    [/^P074[0-4]$/, 'Torque converter clutch. Fluid service first; a shudder that stays usually means converter or valve body.', ['transmission fluid', 'torque converter clutch solenoid'], '$$$', [150, 2000]],
    [/^P07(4[5-9]|[5-9]\d)$/, 'Shift or pressure control solenoid. Fluid service, then solenoid or valve body.', ['transmission shift solenoid', 'transmission fluid'], '$$', [150, 600]],
    [/^P00(8[7-9]|9[0-3])$|^P019\d$/, 'Check fuel pressure: fuel filter, fuel pump, then the pressure sensor.', ['fuel pump', 'fuel filter', 'fuel pressure sensor'], '$$', [150, 600]],
    [/^P0(234|299|046)$|^P2263$/, 'Check for boost leaks (intercooler hoses and boots), wastegate and boost sensor before condemning the turbo.', ['intercooler boot', 'boost pressure sensor'], '$$', [60, 600]],
    [/^P038\d$/, 'Test glow plugs and the glow plug relay/module.', ['glow plug', 'glow plug module'], '$', [80, 300]],
    [/^P2002$|^P246[3-9]$|^P245\d$|^P047[0-3]$/, 'Diesel particulate filter: check the DPF pressure sensor and its hoses, then run a forced regen. A failed DPF is expensive.', ['DPF pressure sensor'], '$$$', [200, 2000]],
    [/^P20EE$/, 'Check DEF quality and level, then the NOx sensors. SCR catalyst replacement is expensive.', ['NOx sensor', 'diesel exhaust fluid'], '$$$', [250, 2000]],
    [/^P048\d$/, 'Check the cooling fan relay, fuse and motor.', ['cooling fan relay', 'radiator cooling fan'], '$$', [60, 300]],
    [/^P046[0-4]$/, 'Fuel level sender in the tank is likely bad.', ['fuel level sending unit'], '$$', [100, 400]],
    [/^P057[1-3]$/, 'Replace the brake light switch.', ['brake light switch'], '$', [15, 60]],
    [/^P06[0-1]\d$/, 'Check battery voltage and grounds first. If the code stays, the engine computer may need reprogramming or replacing (shop job).', ['engine control module'], '$$', [150, 700]],
    [/^P0217$/, 'Do not drive. Check coolant level, fan, water pump and thermostat; pressure-test for leaks or a head gasket.', ['coolant', 'thermostat', 'water pump'], '$$$', [100, 2000]],
    [/^U/, 'Module communication fault. Check battery voltage, fuses and grounds, then a full scan to find the silent module.', [], '$$', [50, 300]],
    [/^C/, 'Chassis code (ABS, steering, suspension). Needs a scan tool that reads the ABS module; wheel speed sensors are the most common cause.', ['ABS wheel speed sensor'], '$', [40, 200]],
    [/^B/, 'Body code (airbag, lights, comfort). Needs a scan tool that reads that module. Airbag light must be fixed before sale.', [], '$$', [50, 300]],
    [/^P[13]/, 'Manufacturer-specific code. Look it up for this make before buying parts.', [], '', [50, 200]],
    [/./, 'Confirm the cause before buying parts.', [], '', [50, 200]],
  ];
  const TIER_WORD = { '$': 'Under $200', '$$': '$200–$1,000, get two quotes', '$$$': 'Likely over $1,000: Jonathan decides fix, wholesale or sell as-is' };
  function fixFor(code) {
    const f = FIXES.find(([re]) => re.test(code));
    return { fix: f[1], parts: f[2], tier: f[3], tierWord: TIER_WORD[f[3]] || '', range: f[4] || [0, 0] };
  }
  const SHOPS = [
    ['AutoZone Pro', 'https://www.autozonepro.com/', true],
    ['Advance', 'https://shop.advanceautoparts.com/web/SearchResults?searchTerm='],
    ['NAPA', 'https://www.napaonline.com/en/search?text='],
    ['Amazon', 'https://www.amazon.com/s?k=']
  ];
  function partLinks(part, vehicle, vin) {
    const q = encodeURIComponent([vehicle, part].filter(Boolean).join(' '));
    return SHOPS.map(([name, url, login]) => ({ name, url: login ? url : url + q, copy: login ? (vin || [vehicle, part].filter(Boolean).join(' ')) : null, part }));
  }

  /* ---------- Cranking test: watch battery voltage while the truck starts ---------- */
  async function crankTest(elm, opts = {}) {
    const seconds = opts.seconds || 12; const onSample = opts.onSample || (() => {});
    const pts = []; const end = Date.now() + seconds * 1000;
    while (Date.now() < end && !(opts.signal && opts.signal.aborted)) {
      try {
        const m = (await elm.send('ATRV', 1500)).join('').match(/(\d+(\.\d+)?)/);
        if (m) { const v = +m[1]; pts.push({ t: Date.now(), v }); onSample(v, 1 - (end - Date.now()) / (seconds * 1000)); }
      } catch (e) { /* a reading can drop out while cranking */ }
    }
    return { at: new Date().toISOString(), pts };
  }
  function assessCrank(r) {
    const vs = r.pts.map((p) => p.v);
    if (vs.length < 5) return { overall: 'watch', findings: [{ level: 'watch', title: 'Cranking test incomplete', detail: 'Not enough readings. Try again.' }] };
    const rest = vs[0], min = Math.min(...vs), last = vs.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, vs.length);
    const F = [];
    if (rest - min < 0.8) F.push({ level: 'watch', title: 'No crank seen', detail: 'Voltage barely dipped (' + min.toFixed(1) + ' V). Start the truck during the test.' });
    else if (min < 9.6) F.push({ level: 'problem', title: 'Weak battery: dropped to ' + min.toFixed(1) + ' V while cranking', detail: 'Under 9.6 V while starting. Load-test and plan on a battery.', parts: ['battery'] });
    else if (min < 10.2) F.push({ level: 'watch', title: 'Battery borderline: ' + min.toFixed(1) + ' V while cranking', detail: 'Load-test before sale, especially going into winter.', parts: ['battery'] });
    else F.push({ level: 'good', title: 'Cranking voltage good: ' + min.toFixed(1) + ' V low', detail: 'Started at ' + rest.toFixed(1) + ' V.' });
    if (last > 12.9) {
      if (last < 13.2) F.push({ level: 'problem', title: 'Not charging after start: ' + last.toFixed(1) + ' V', detail: 'Check alternator and cables.' });
      else if (last > 15) F.push({ level: 'problem', title: 'Overcharging after start: ' + last.toFixed(1) + ' V', detail: '' });
      else F.push({ level: 'good', title: 'Charging after start: ' + last.toFixed(1) + ' V', detail: '' });
    }
    const overall = F.some((f) => f.level === 'problem') ? 'problem' : F.some((f) => f.level === 'watch') ? 'watch' : 'good';
    return { overall, findings: F, min, rest, last };
  }

  function describeCode(code) {
    if (CODES[code]) return CODES[code];
    const sys = { P: 'Engine / transmission', C: 'Chassis (brakes, steering, suspension)', B: 'Body (airbags, lights, comfort)', U: 'Network / module communication' }[code[0]];
    const maker = code[1] === '1' || code[1] === '3' && code[0] === 'P' ? ', manufacturer-specific' : '';
    return sys + ' code' + maker;
  }

  function codeSeverity(code) {
    const n = parseInt(code.slice(1), 16);
    if (code[0] === 'P') {
      if (/^P03(0\d|1[0-6])$/.test(code)) return 'problem';            // misfires
      if (/^P0[78]/.test(code)) return 'problem';                       // transmission
      if (['P0217','P0420','P0430','P0524','P0087','P0093','P0335','P0016','P0017','P0018','P0019','P0299','P20EE','P2002','P2463','P0606','P0601','P0620'].includes(code)) return 'problem';
      if (/^P04[4-5]/.test(code)) return 'watch';                       // EVAP
    }
    if (code === 'U0100' || code === 'U0101') return 'problem';
    if (code[0] === 'C' && n >= 0) return 'watch';
    return 'watch';
  }

  /* ---------- Turn readings into a plain-words verdict ---------- */

  function assess(r, enteredMiles) {
    const F = [];
    const add = (level, title, detail, code) => F.push({ level, title, detail: detail || '', code });
    const s = r.status;

    if (s && s.mil) add('problem', 'Check engine light is ON', 'The truck’s computer has turned on the light' + (r.milDistanceMi ? ' and it has been on for ' + r.milDistanceMi.toLocaleString() + ' mi.' : '.'));
    for (const c of r.stored || []) add(codeSeverity(c), c + ' — ' + describeCode(c), 'Stored code (confirmed fault).', c);
    for (const c of r.pending || []) if (!(r.stored || []).includes(c)) add('watch', c + ' — ' + describeCode(c), 'Pending code: seen once, may turn the light on if it happens again.', c);
    for (const c of r.permanent || []) if (!(r.stored || []).includes(c)) add('watch', c + ' — ' + describeCode(c), 'Permanent code: the fault was cleared but the truck hasn’t proven it’s fixed yet.', c);

    const incomplete = s ? s.monitors.filter((m) => !m.complete) : [];
    const recent = (r.distSinceClearMi != null && r.distSinceClearMi < 60) || (r.warmupsSinceClear != null && r.warmupsSinceClear < 5);
    if (recent) {
      const bits = [];
      if (r.distSinceClearMi != null) bits.push(r.distSinceClearMi + ' mi');
      if (r.warmupsSinceClear != null) bits.push(r.warmupsSinceClear + ' warm-ups');
      add('problem', 'Codes were cleared recently', 'Only ' + bits.join(' / ') + ' since the last reset. Faults may be hidden. Drive 50–100 mi (mix of town and highway) and scan again.');
    }
    if (incomplete.length >= 2) add(recent ? 'watch' : 'watch', incomplete.length + ' self-tests not finished', incomplete.map((m) => m.name).join(', ') + '. Normal right after a battery disconnect or code clear; otherwise worth a rescan after a drive.');
    else if (incomplete.length === 1) add('good', 'Self-tests: 1 not finished', incomplete[0].name + ' (common, usually finishes with normal driving).');
    else if (s && s.monitors.length) add('good', 'All self-tests finished', s.monitors.length + ' of ' + s.monitors.length + ' complete.');

    const v = r.voltage != null ? r.voltage : r.moduleVoltage;
    if (v != null) {
      if (r.engineRunning) {
        if (v < 13.2) add('problem', 'Not charging: ' + v.toFixed(1) + ' V running', 'Alternator or wiring should be checked.');
        else if (v > 15) add('problem', 'Overcharging: ' + v.toFixed(1) + ' V running', 'Voltage regulator / alternator should be checked.');
        else if (v < 13.5) add('watch', 'Charging a little low: ' + v.toFixed(1) + ' V running', '');
        else add('good', 'Charging normally: ' + v.toFixed(1) + ' V running', '');
      } else {
        if (v < 12.2) add('problem', 'Battery low: ' + v.toFixed(1) + ' V', 'Charge and load-test the battery.');
        else if (v < 12.4) add('watch', 'Battery a little low: ' + v.toFixed(1) + ' V', 'Load-test if it cranks slow.');
        else add('good', 'Battery voltage good: ' + v.toFixed(1) + ' V', 'Engine off. A load test is still the real check.');
      }
    }
    if (r.coolantF != null && r.engineRunning && r.coolantF > 230) add('problem', 'Running hot: ' + r.coolantF + '°F coolant', '');
    if (r.odometerMi && enteredMiles && Math.abs(r.odometerMi - enteredMiles) > 1000) {
      add('watch', 'Mileage mismatch', 'Truck computer reports ' + Math.round(r.odometerMi).toLocaleString() + ' mi, dash entered as ' + (+enteredMiles).toLocaleString() + ' mi.');
    }
    if (!r.vin) add('watch', 'VIN not readable from the computer', 'Normal on some older trucks. Type it in from the door jamb.');
    else if (!r.vinValid) add('watch', 'VIN check digit doesn’t match', 'Compare the computer VIN to the door jamb and title.');
    if (s && !s.mil && !(r.stored || []).length && !(r.pending || []).length && !recent) add('good', 'No trouble codes', 'No stored or pending codes.');

    const order = { problem: 0, watch: 1, good: 2 };
    F.sort((a, b) => order[a.level] - order[b.level]);
    const overall = F.some((f) => f.level === 'problem') ? 'problem' : F.some((f) => f.level === 'watch') ? 'watch' : 'good';
    return { overall, findings: F };
  }

  const stockFromVin = (vin) => (vin && vin.length >= 6 ? vin.slice(-6).toUpperCase() : null);
  const OBD = { SerialTransport, BleTransport, DemoTransport, DEMO_TRUCK, Elm, runScan, assess, describeCode, codeSeverity,
    idleCheck, assessIdle, parseMode06, stockFromVin, fixFor, partLinks, crankTest, assessCrank, TIER_WORD,
    freezeFrame, describeFreeze, moduleScan, assessModules, moduleFix, makeFamily, driveLog, afterDrive, assessDrive,
    parseMessages, parseDtcs, parseVin, parseMonitors, parseSupport, vinCheckOk, decodeDtc, cleanLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = OBD; else root.OBD = OBD;
})(typeof window !== 'undefined' ? window : globalThis);
