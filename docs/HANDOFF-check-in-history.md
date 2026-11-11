# Check-In Scan — handoff to Dylan

Written Nov 9, 2026 at the end of the session where Jonathan and Claude built the app. This file is the complete record of what was built, why, where everything lives, and how to keep going. It lives in the app's repository, so any Claude session you open on `littlecountrycars/lcc-check-in-scan` can read it.

You own this app now. Change anything you want; the only things that need Jonathan's sign-off are process changes (anything that changes the recon SOP) and the $1,000 rule.

---

## 1. Start here

### What you need (one time)
1. **A GitHub account.** Accept the invite from GitHub to the **littlecountrycars** organization (it went to dylan@littlecountrycars.com). If you don't have an account, the invite walks you through making a free one. Members have edit access to every app in the organization.
2. **Claude.** You're already in the Little Country Cars Claude workspace. The littlecountrycars GitHub organization is connected to the workspace for all repositories, so your Claude sessions can open and publish these apps. You don't need to connect anything else.
3. **Chrome on your Android phone, version 138 or newer.** Play Store → Chrome → Update.

### Start your own Claude session
1. On a laptop (easiest) or in the Claude app, open **Code** and start a **new session**.
2. Pick the repository **littlecountrycars/lcc-check-in-scan**.
3. Paste this as your first message:

> Read HANDOFF.md and CLAUDE.md in this repo. I'm Dylan and I own this app now. The scanner isn't connecting on my phone. Here's exactly what happens: [describe each tap and what the screen says, or attach screenshots]. My phone is a [make/model], Android [version], Chrome [version from Chrome → Settings → About Chrome]. Walk me through fixing it, and if the app needs a change, make it, test it on the demo truck, and publish it.

Claude will read this file, so it starts out knowing everything below.

---

## 2. Scanner won't connect — check these in order

The app talks to the blue Veepeak over **classic Bluetooth** using a Chrome feature called Web Serial. These are the usual causes, most likely first.

**First, open the Connection log** (under the connect buttons). It shows every step and every message to and from the scanner. If connecting fails, screenshot it or tap **Copy log** and send it to Claude.

**Normal, not a problem:** in Android Bluetooth settings the Veepeak shows as *paired* but not *connected*, or connects and drops after a few seconds. That's how classic-Bluetooth scanners work: the link only opens while an app is using it.

1. **Another app is holding the Veepeak.** Classic Bluetooth adapters only allow one connection at a time. If Car Scanner, Torque, OBD Fusion or any other scan app has connected to it since it was plugged in, the Check-In app can't get in. Fix: force-stop the other apps (Android Settings → Apps → [app] → Force stop), unplug the Veepeak for 5 seconds, plug it back in, then connect from Check-In.
2. **Not paired in Android.** With the Veepeak in a truck and the key ON: Android Settings → Connected devices / Bluetooth → Pair new device → **OBDII** (PIN **1234**). It has to show as paired before the app can see it. If the app says *"No scanner picked. If the Veepeak isn't in the list, pair it in Android Bluetooth settings first,"* this is the problem.
3. **Chrome too old, or not Chrome.** It must be the real Chrome app (not Samsung Internet, not a browser inside another app). If the app says *"This Chrome can't reach classic Bluetooth scanners yet,"* update Chrome. Chrome → ⋮ → Settings → About Chrome shows the version; it needs 138 or newer.
4. **Chrome isn't allowed to use Bluetooth.** Android Settings → Apps → Chrome → Permissions → **Nearby devices** → Allow. Also make sure Bluetooth is on.
5. **Picked the wrong device.** Tap **Pick a different scanner** and choose **OBDII**. The app remembers the last one you picked; this clears that.
6. **Connected, but "the truck didn't answer."** That message means the phone reached the Veepeak but the Veepeak couldn't reach the truck. Key must be ON (or engine running). Wait 5 seconds and tap Scan again. Check the Veepeak's light is on.
7. **"The scanner stopped answering."** Unplug the Veepeak 5 seconds, plug back in, Disconnect/Connect in the app, scan again.
8. **Still stuck:** send Claude a screenshot of the Connection log (or paste it after tapping Copy log), plus what you tapped.

Note: the app was tested end to end on the built-in **demo truck** and the code that decodes real scanner replies was tested against sample replies, but it had **not yet been run against a real truck** when this was written. Expect a first round of fixes; that's normal.

### Why Web Serial and not a Play Store app
The Veepeak you have is the classic-Bluetooth (Android-only) model. Chrome on Android added the ability for a web page to talk to classic Bluetooth serial devices in version 138. That let us build a web app instead of a Play Store app: no developer account, no sideloading, and every change reaches your phone automatically. The trade-off: it only works in Chrome on Android (not iPhone), and it's a newer Chrome feature, so phone-specific quirks are possible. Bluetooth LE scanners (the kind that work with iPhones) are also supported through the **Bluetooth LE scanner** link, as a backup.

---

## 3. The app

- **Live:** https://littlecountrycars.github.io/lcc-check-in-scan/
- **Code:** https://github.com/littlecountrycars/lcc-check-in-scan
- **Install on your phone:** open the live link in Chrome → ⋮ → **Add to Home screen** (or Install app). If you installed it from the old golittle.github.io address, delete that icon; the old address no longer works.
- **monday.com token:** tap the gear → paste your token (monday → your picture → Developers → My access tokens → Copy) → **Test connection** → Done. It's stored only on your phone, and posts show under your name. A new install or a new address means pasting it again.
- **Practice:** **Practice with a demo truck** runs every step with a fake 2018 F-150 (misfire on cylinder 3, ABS wheel-sensor code, codes cleared recently). Nothing posts to monday from the demo.

### What it does, step by step (the order in the app)
1. **Scanner** — Connect scanner / Pick a different scanner / Bluetooth LE scanner / Practice with a demo truck.
2. **Scan the truck** (key on, engine off is best). Enter dash mileage. It reads:
   - **VIN** → the **last 6 characters become the Stock #**, used to find the vehicle on Inventory Recon.
   - **Check engine light**, **stored / pending / permanent codes**, each with a plain-English meaning, a likely fix, parts, and a cost tier.
   - **Freeze frame** for the code that set the light (speed, RPM, engine temp, load, fuel trim at that moment).
   - **Miles and warm-ups since codes were last cleared** — flags trucks cleared before auction.
   - **Readiness monitors** (the truck's self-tests), battery voltage, coolant temp, fuel level, the computer's odometer (flags a mismatch with the dash).
   - **Ford only (box ticked by default):** airbag, ABS, transmission, power steering, 4x4, body, cluster and gateway modules. Adds ~20 seconds.
   - Online lookups: year/make/model from the VIN (NHTSA) and a link to check open recalls.
3. **Battery, idle & misfires**
   - **Cranking test:** tap start, start the truck within 5 seconds. Under 9.6 V while cranking = weak battery; 9.6–10.2 = borderline. Also checks it charges once running.
   - **30-second idle check** (warm, park, A/C and lights off, don't touch the gas): RPM steadiness, fuel trims (lean/rich), and the engine computer's own **misfire counters per cylinder** (2008+ CAN trucks). Suggests a tune-up when it sees misfire patterns.
4. **Test drive** — tap Start before pulling out, phone mounted, don't touch it. 10+ minutes: town, a few hard accelerations, 30 seconds steady at 45–65 mph. Tap End when parked. It flags **RPM flares while accelerating** (slipping shifts), **RPM wavering at steady speed** (torque converter shudder), **overheating / never warming up**, and **new codes** that appeared during the drive.
5. **Estimate & send**
   - A **Day-1 estimate** line is prefilled for each finding using typical parts + labor ranges. Change each to your real number, remove what you won't do, add lines (tires, detail, glass, body).
   - Over $1,000 (or any likely big-ticket repair) shows a warning, and sending **notifies Jonathan in monday** to decide fix, wholesale or sell as-is.
   - Each part has buttons for **AutoZone Pro, Advance, NAPA, Amazon**. Advance/NAPA/Amazon open a search for that year/make/model + part. **AutoZone Pro** needs your login, so the button **copies the VIN** and opens AutoZone Pro; paste it into the VIN lookup, then search the part named.
   - **Send to monday.com** finds the vehicle by Stock #. If it's not on the board, it adds it under Initial Inspection / On Site. If several match, you pick. You can also search by name.
   - **Save PDF** prints a clean report.
6. **Recent scans** keeps the last 25 on your phone. Anything that failed to send can be sent later from there.

The app **never clears codes.**

### What gets written to monday.com (Inventory Recon)
- An **update** on the vehicle with the full report: verdict, every finding with fix, cost and part links, cranking, idle, test drive, itemized estimate, recall link, your notes.
- The **Day-1 Estimate** column (total).
- **Stock #** if it was blank.
- Subitems **Walk-around: Check engine light** and **Walk-around: Battery**: Status (Done / Needs Attention), Notes (appended, dated), Parts Needed. There's a checkbox to turn this off.
- A **notification to Jonathan** when it's over $1,000.

---

## 4. Decisions made, and why

| Decision | Why |
|---|---|
| Keep the Veepeak; build our own app instead of using Car Scanner/Torque | Those apps can't write to monday or follow our process. Chrome 138+ can talk to the Veepeak directly. |
| Web app installed from Chrome, not a Play Store app | No developer account or sideloading; updates reach your phone automatically. |
| Hosted on GitHub Pages, not as a Claude artifact | Claude artifacts can't use Bluetooth. |
| Stock # = last 6 of VIN | Matches how Inventory Recon is already keyed (e.g. A80955, B94060). |
| Write into Inventory Recon (board 18410463373), not a new board | It's where recon already happens; walk-around/hoist subitems already exist. |
| **Day-1 estimate lives in monday during intake** (Jonathan's call) | One place for the intake work. DealerCenter stays the record for dates (Purchase Date, Date In Stock, Ready To Sell) and final dollars. Never enter the same fact twice. |
| Over $1,000 → notify Jonathan before work | Straight from the recon SOP. |
| Prefilled typical costs, editable | Gets an estimate on the page in seconds; your real numbers replace them. Tell Claude our actual costs so the defaults match. |
| Cost tiers ($ under $200, $$ $200–1,000, $$$ over $1,000) | Line up with the SOP's two-quote rule (>$200) and sign-off rule (>$1,000). |
| AutoZone Pro copies the VIN | Pro searches by VIN behind a login; there's no direct search link. |
| Each person uses their own monday token, stored on their phone | Posts show under the right name; no shared password in the code. |
| Read-only (never clears codes) | Clearing hides problems and resets the self-tests. |
| Ford module scan first | Most of our inventory is Ford trucks. Other makes need their own module addresses; add them as needed. |
| Recorded test drive added to the SOP | Catches transmission slip/shudder that customers find otherwise. |
| Pre-sale rescan **not** in this app | Jonathan wants appraisal/acquisition scanning in a separate app so it doesn't mix with inventory recon. |
| Dash/VIN photos — not added | Jonathan passed on it. |
| Moved code from Jonathan's personal GitHub (golittle) to the **littlecountrycars** organization | So you, Simon and Claude sessions across the workspace can all get to it, and future apps go in the same place. This changed the app's address. |
| Brand kit applied | Every LCC tool uses it: Country Orange #FF8C00, black, white, #666666; status green/red only for state; Fjalla One headings, Arial body; rounded corners; Nebraska orange icon. |
| App icons are PNG (192, 512, maskable) plus the SVG | Chrome on Android won't install an app from an SVG-only icon; that's why Add to Home screen failed at first (fixed Nov 9). |

---

## 5. Where everything lives

| What | Where |
|---|---|
| Live app | https://littlecountrycars.github.io/lcc-check-in-scan/ |
| Code | https://github.com/littlecountrycars/lcc-check-in-scan |
| Notes Claude reads every session | `CLAUDE.md` (rules, board/column IDs) and this `HANDOFF.md` |
| monday board | Inventory Recon (new): https://littlecountrycars.monday.com/boards/18410463373 |
| monday columns | Stock # `text_mm2txesd`, Stage `color_mm2tny8k`, Location `color_mm2yxmdw`, **Day-1 Estimate `numeric_mm8x1pk1`** (added for this app). Subitems: Status `color_mm2t1egg`, Notes `long_text_mm2t42xe`, Parts Needed `text_mm2tdxxp`. |
| SOP | **Recon Intake And The Day-1 Estimate (v1.3 draft)** in LCC Shared Drive › Recon & Lot: https://docs.google.com/document/d/1OAggSMCNlOb26YGZ_gDFbTjEezncXzv4PU-nbz_W06c/edit — the original v1.2 is still there; archive it once v1.3 is approved. |
| Shared rules for all LCC apps | The **lcc-app-building** skill (Jonathan is sharing it to the workspace) and the **lcc-brand** skill |

### Files in the code
- `obd.js` — the scanner engine: Bluetooth connections (classic, LE, demo), scanner commands, decoding codes/VIN/monitors, idle and misfire check, cranking test, freeze frame, Ford module scan, test-drive analysis, the fix/parts/cost table (`FIXES`), and the parts store links (`SHOPS`). **To change fixes or typical costs, edit `FIXES`.**
- `app.js` — the screens, estimate builder, and everything that talks to monday.com.
- `index.html` — layout and styling.
- `sw.js` — lets the app open with no signal on the lot. Its `CACHE` name must change whenever files change so phones get the update.
- `manifest.webmanifest`, `icon.svg`, `icon-app.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` — home-screen install and icons.

---

## 6. Making changes

1. Open your Claude session on `littlecountrycars/lcc-check-in-scan`.
2. Say what you want in plain words. Examples: "make the estimate buttons bigger," "our battery cost is $165, use that," "add a check for transmission temperature on the test drive," "add Chevy module codes."
3. Ask Claude to test it on the demo truck and publish. Publishing = pushing to `main`. It's live in about a minute; your phone gets it the next time you open the app (close and reopen if needed).
4. If a change affects the process (what gets done when, who signs off), update the SOP to match and run it by Jonathan.

---

## 7. Known limits

- Never yet run on a real truck when this was written (see section 2).
- Classic-Bluetooth scanning works only in Chrome on Android, 138+. No iPhone with this Veepeak.
- Module codes (airbag/ABS/etc.) only for Ford, only on CAN trucks (roughly 2008+). Some Fords may not answer through the Veepeak.
- Per-cylinder misfire counters only on CAN trucks that share them; otherwise the idle RPM check is the guide.
- Mileage comes from the truck when it can: the standard odometer reading (mostly 2019+), or on Fords the engine computer (22 DD01, read in km and converted). Not every truck reports it; then type it from the dash. Typed dash miles always win. Unverified on a real truck as of Nov 9; compare against the dash on the first few.
- Typical costs are national ballpark ranges, not our real costs.
- Only the Check engine light and Battery walk-around subitems are filled automatically.

## 8. Ideas not built yet (your call)

- Our real parts and labor costs in the estimate defaults.
- Fill more walk-around/hoist items automatically.
- Module codes for Chevy/GM, Ram, Toyota.
- Transmission temperature on the test drive (Ford-specific reading).
- Separate **acquisition app** for pre-purchase/appraisal scans (Jonathan's idea; keep it separate from this one).
- Anything you find yourself writing down by hand at check-in.

---

## 9. How we got here (session timeline, Nov 7–9, 2026)

1. Jonathan asked for a program that works with our OBD2 scanner at check-in to capture, document and communicate vehicle health to the team and systems. Answers: Bluetooth adapter, Android phone, results to monday.com.
2. Claude checked the LCC brand kit, the Inventory Recon board (columns, Walk-around/Hoist subitems, stock # format), and the recon SOPs ("Checking In A Vehicle" is badging only; the scan belongs to "Recon Intake And The Day-1 Estimate").
3. Jonathan said we use the blue Veepeak (classic Bluetooth). Claude chose Chrome's Web Serial so a web app can talk to it, and made it an installable app for your phone.
4. Built the scanner engine, demo truck and screens; tested decoding against sample scanner replies and the full flow in a phone-sized browser.
5. Jonathan added: VIN last 6 → Stock #; idle RPM/misfire/tune-up detection; codes stored in notes with fix and parts from AutoZone Pro, Advance, NAPA, Amazon. Claude added the cranking test, cleared-codes flag, recall check and $1,000 flag.
6. Jonathan decided: estimates go in monday; AutoZone Pro (VIN-based); yes to module codes, freeze frame and recorded test drive; pre-sale rescan belongs in a separate acquisition app; no photos. Claude added the Day-1 Estimate column, built those features, and wrote SOP v1.3 with the test-drive section.
7. Published on GitHub Pages and emailed you setup instructions.
8. Connected GitHub to the Claude workspace properly, created the **littlecountrycars** organization, moved the app there (new address), invited you and Simon with edit access, and emailed you the new link.
9. Wrote this handoff so you can run your own session.
