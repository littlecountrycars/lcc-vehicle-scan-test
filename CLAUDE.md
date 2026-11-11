# LCC Vehicle Scan TEST — notes for Claude

## This is the TEST copy
This repo (littlecountrycars/lcc-vehicle-scan-test) is the test copy of LCC Vehicle Scan. Test address: https://littlecountrycars.github.io/lcc-vehicle-scan-test/ (GitHub Pages from `main`, root). The real app is littlecountrycars/lcc-vehicle-scan at https://littlecountrycars.github.io/lcc-vehicle-scan/.

**Changes get made here first.** Make the change in this repo, run `node tests/demo-test.js`, bump `VERSION` in `sw.js`, push, and try it on a phone from the TEST icon. When it's right, copy it to lcc-vehicle-scan: copy **every file except `manifest.webmanifest` and the icons** (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`), run the demo-truck test there, and push.

Only these differ from the real app, and they must never be copied over:
- `manifest.webmanifest`: name "LCC Vehicle Scan TEST", short name "Scan TEST", and `"id": "/lcc-vehicle-scan-test/"`. The real app's `"id": "./"` is worked out by Chrome from the site root (`https://littlecountrycars.github.io/`), so without its own id the test copy counts as the same app and Android says "already installed".
- The PNG icons have a black "TEST" band across the bottom so the two home-screen icons look different.
- This TEST section of CLAUDE.md and the top of README.md (keep the real repo's own wording when copying those two back).

Everything else (`app.js`, `obd.js`, `index.html`, `sw.js`, `modes/`, `tests/`) is the same code as the real app. The code sees `-test/` in the address and then keeps its own saved data under `lccVST.*` (never touching the live app's `lccVS.*`), its own offline database (`lcc-vehicle-scan-test`), shows a black TEST APP bar, and asks for a second tap before sending to monday.com. On first open it borrows the live app's name, monday token and settings once; scan history stays separate. **Sends from the test copy go to the real Inventory Recon board.**

Who may push and the rest of the rules below are the same as for the real app. The notes below were copied from the real app; read "Live" as the real app's address.

One web app for Little Country Cars' Veepeak Bluetooth OBD2 scanner, with three modes. Made Nov 10, 2026 by merging Check-In Scan (littlecountrycars/lcc-check-in-scan) and Acquisition Scan (littlecountrycars/lcc-aquisition-scan) so the shared scanner code is kept in one place. The old repos are archived; their addresses redirect here.

Live: https://littlecountrycars.github.io/lcc-vehicle-scan/ (GitHub Pages from `main`, root). Repo: littlecountrycars/lcc-vehicle-scan. Pushing to `main` publishes; phones get the new version next open.

## Who owns what
| Part | Files | Owner | Sign-off |
|---|---|---|---|
| Shared engine and screens | `obd.js`, `app.js`, `index.html`, `sw.js`, tests | **Dylan** | Jonathan for process/money changes |
| Read codes | `modes/codes.js` | **Dylan** | |
| Check-In mode (recon, monday.com) | `modes/checkin.js` + the monday.com section of `app.js` | **Dylan** | Jonathan (recon SOP, $1,000 rule) |
| Auction mode (buying) | `modes/auction.js` | **Jonathan** | Jonathan |
| Trade mode (sales) | `modes/trade.js` | **Simon** | Jonathan for the offer math |
| Money math (max bid, trade offer, red flags) | `maxBid`, `theCall`, `redFlags` in `app.js` | Dylan maintains | **Jonathan** |

A mode owner changes their own `modes/*.js` freely (wording, labels, defaults, keep days). Anything in the shared files affects every mode.

## How to make changes without stepping on each other
Dylan is the product owner of Vehicle Scan.
1. **Dylan may push straight to `main`** (it publishes) whenever he's ready; no review needed. Run the demo-truck test first.
2. **Everyone else** (Simon, Jonathan's sessions, anyone new) works on a branch named for the person and change (`simon/trade-offer-wording`) and opens a pull request. Dylan reviews and merges.
3. The **Demo truck test** (GitHub Actions, `tests/demo-test.js`) runs on every push and pull request: all three modes scan, idle, drive and show their result; Auction and Trade make no monday.com calls; mode 04 is never sent; old data carries over. If it goes red on `main`, fix it first.
4. Changes to the money math (max bid, trade offer, red flags) or to the recon process: agree them with Jonathan (he has the final say on those), then push. No pull request needed for Dylan.
5. Change only your own mode file unless the pull request says why.
6. Bump `VERSION` in `sw.js` on every change that ships, so phones fetch the new files.
7. Run `node tests/demo-test.js` locally before pushing (`npm i --no-save playwright && npx playwright install chromium` once).

When the session belongs to someone other than Dylan, use a branch and a pull request even if git would allow a direct push.

## How the app flows (test copy, Nov 11, 2026)
1. **Start screen:** Connect scanner, and Recent scans (every kind, newest first). No mode is picked up front.
2. **Connect:** the vehicle is read by itself: VIN (NHTSA lookup for year, make, model, trim, engine, drive, transmission gears), computer miles, codes, self-tests, battery, freeze frame, and Ford airbag/ABS/transmission/body modules. Miles, Stock # and Color can be typed over.
3. **Pick what to do with it:** Read codes, Check-In, Auction or Trade (tap the title, "Change", to switch for the same vehicle). A scan is saved to the phone once one is picked.
4. Inside a mode, the vehicle line stays pinned under the header (e.g. `2016 F150 XLT Green 102k 2.7L V6`, the same style as monday.com item names).
5. **Recent scans:** tap one for its summary page (the same report that's shared or sent to monday.com), with Share, Send (unsent Check-In) and Open in monday.com (sent).

## Modes
- **Read codes** (`codes`): just the health card (codes, likely fix, parts, self-tests, recalls) and Share. No battery/idle, drive, estimate or money. Never touches monday.com. Kept 30 days.
- **Check-In** (`checkin`): a vehicle LCC bought arrives. Stock # = last 6 of the VIN. Full test drive. Day-1 estimate. Sends to monday.com Inventory Recon; over $1,000 notifies Jonathan. Kept on the phone 30 days.
- **Auction** (`auction`): appraising at a physical auction, including vehicles we may not buy. Quick appraisal (the read already covers scan + freeze frame + Ford modules; then a 15-second idle), the call (Bid / Caution / Walk away), max bid, next vehicle (bumps a numeric lane/run #), lane drive (~300 m, 35-45 mph; torque converter shudder can't be checked), lookups retried when signal returns. **Never touches monday.com.** Kept 8 days by default (the same unit can come back at next week's auction).
- **Trade** (`trade`): Simon valuing a customer's trade at the desk. Quick appraisal (15-second idle), full test drive, the call (Good trade / Adjust offer / Wholesale only), trade offer, payoff and customer equity, a customer copy with no prices or internal notes. **Never touches monday.com.** Kept 30 days.

Max bid / trade offer = expected sale price (typed, from SCOUT's expected sale price) − this vehicle's estimated recon − minimum profit/gross wanted (setting, default $2,500 per Jonathan) − fees/transport (setting, default $0). Don't use SCOUT's max bid as the input: SCOUT already subtracts its own typical recon and gross. Hard red flags (Walk away / Wholesale only): codes cleared recently with 2+ self-tests unfinished, odometer mismatch > 1,000 mi (typed dash vs computer), transmission codes, airbag faults, active transmission-module faults, slipping on the drive (felt by the driver, or big repeated flares), torque converter shudder, or an offer at or below $0.

**Estimates are LCC's cost, not retail** (Nov 11, 2026, Dylan; **not yet agreed with Jonathan**, since they feed max bid / trade offer and the $1,000 rule): parts at our price (Walmart or a used battery about $50-100, used/junkyard, RockAuto, Amazon) plus our own labor. Ranges live in `FIXES` and `MODULE_FIX` in `obd.js` and in `suggestedLines` in `app.js`. Tiers follow the new ranges: a catalytic converter (P0420/P0430) and an engine computer code are now `$$`, so on their own they no longer trigger "likely over $1,000"; the total still does.

**Misfires:** occasional misfires are normal and need no parts. "Active misfire" (problem, plan on plug + coil) = a misfire code on that cylinder (P0301-P0312), or that cylinder's this-trip counter 30+ and 3x the others, or its 10-trip average 50+ while still misfiring this trip. A high 10-trip average that isn't misfiring now = "Past misfires" (watch, no parts). Only an active misfire or a rough idle adds plugs and coils to the estimate.

**Shift flares:** a flare only counts when RPM jumps without the truck speeding up and then drops back (a slip); a jump that stays up is a downshift. 8- and 10-speeds (gear count from the VIN) need a 500+ RPM jump to count, others 350+. With any flare the app asks "Did it feel like it slipped?": Yes = problem (hard red flag), No = fine. Without an answer it's a watch, unless there are 5+ flares with 3+ big ones (900+ RPM on 8/10-speeds, 700+ otherwise), which is a problem on its own.

The mode is picked per vehicle after it's read (see How the app flows). `?mode=codes|checkin|auction|trade` in the link goes straight to that mode once the vehicle is read (home-screen shortcuts use this). `#vin=<VIN>&sale=<price>` fills a sale price into a saved Auction/Trade appraisal (for a future SCOUT "send back" button).

## Files
- `obd.js`: scanner engine. Transports (Web Serial classic Bluetooth, Web Bluetooth LE, demo truck), ELM327 commands, code parsing, idle/misfire, cranking test, freeze frame, Ford module codes (UDS 0x19), drive analysis (`assessDrive(r, before, after, { lane })`), fix/parts/cost table (`FIXES`), parts links (`SHOPS`).
- `app.js`: start screen, vehicle read and pick, modes, summary page, estimate, red flags/call/offer, reports, share/PDF, monday.com (Check-In only), history, settings, migration from the old apps.
- `modes/codes.js`, `modes/checkin.js`, `modes/auction.js`, `modes/trade.js`: each mode's wording and defaults (`basic: true` in codes.js hides the battery/idle, drive and estimate steps).
- `index.html`: layout and styles. Starts with the loading screen (`#splash`): the Nebraska border traces, fills orange and bounces, then "Little" and "Country" rise one word at a time (about 1.7 s, tap to skip). It is CSS only, so it fades out even if a script fails, and a small inline script removes it. Elements with `data-modes="..."`, `data-money="bid"`, `data-dest="monday|phone"` or `data-quick` show only where they apply.
- `sw.js`: offline copy in this app's own IndexedDB database (`lcc-vehicle-scan`), never Cache Storage. Only handles its own folder.
- `manifest.webmanifest`: home-screen install, with a shortcut per mode.
- `tests/demo-test.js`: the demo-truck test. `.github/workflows/demo-test.yml` runs it.
- `docs/HANDOFF-check-in-history.md`: the original Check-In Scan history (decisions, scanner troubleshooting). Its addresses refer to the old app.

## Saved on the phone
- localStorage keys `lccVS.*` only (`settings`, `history`, `lastTransport`, `mode`, `migrated`). Never read or clear other apps' keys, except the one-time read of `lccScan.*` (Check-In) and `lccAcq.*` (Acquisition) on first open, which copies the monday token, name, Auction profit/fees and both histories. The old keys are left in place.
- One history list; each record has `mode`; each mode shows its own and keeps it for its own number of days.
- Each user's monday.com token is stored only on their phone. Never commit tokens.

## monday.com (Check-In mode only)
- Board: Inventory Recon (new) `18410463373`; subitems board `18410479838`.
- Columns: Stock # `text_mm2txesd`, Stage `color_mm2tny8k`, Location `color_mm2yxmdw`, Day-1 Estimate `numeric_mm8x1pk1`. Subitem columns: Status `color_mm2t1egg`, Notes `long_text_mm2t42xe`, Parts Needed `text_mm2tdxxp`.
- Over $1,000 notifies Jonathan (user `101601751`).
- Auction and Trade must not read or write monday.com unless Jonathan asks for it.

## Scanner won't connect
The Veepeak is classic Bluetooth: one app at a time. Another scan app (Car Scanner, Torque, OBD Fusion, Veepeak's own app) with auto-connect on can grab it in the background, and then this app can't open it. Fix: turn off auto-connect in that app (or uninstall unused scan apps), force-stop it, unplug the Veepeak 5 seconds, key ON, Try again. The app shows these steps under "Scanner won't connect?" when a connection fails, and the Connection log (Copy log) shows every step. More in `docs/HANDOFF-check-in-history.md` section 2.

## Rules
- Read-only scanner: never send mode 04 (clear codes). The test checks this.
- SCOUT (LCC's buy guide) is a private claude.ai artifact: https://claude.ai/artifact/6bBGxC5drP42KJE9sGJYgZ. The app only links to it and copies the VIN. Never copy SCOUT's sales data, costs or gross into this public repo.
- LCC Brand Kit (lcc-brand skill): Country Orange #FF8C00, black, white, #666666 small print; status green #2E7D32 / red #C62828 only for state. Fjalla One headings, Arial body. Rounded corners. Nebraska orange icon. Plain, specific wording.
- Parts: AutoZone Pro (button copies the VIN for Pro's VIN lookup), Advance, NAPA, Amazon.
- Process lives in the SOP "Recon Intake And The Day-1 Estimate" (Recon & Lot folder). Keep Check-In mode and the SOP in step.
- Test with the demo truck before merging; nothing posts to monday from the demo.
