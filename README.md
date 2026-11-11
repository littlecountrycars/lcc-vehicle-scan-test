# LCC Vehicle Scan TEST

**This is the test copy of LCC Vehicle Scan.** Try changes here before they reach the real app.

- Test app: https://littlecountrycars.github.io/lcc-vehicle-scan-test/ (shows a black TEST APP bar; its home-screen icon says TEST)
- Real app: https://littlecountrycars.github.io/lcc-vehicle-scan/ (repo littlecountrycars/lcc-vehicle-scan)

Changes get made here first. When they work, copy them to lcc-vehicle-scan with every file **except `manifest.webmanifest` and the icons** (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`), which are the only files that make this copy look different. (This TEST section of README.md and of CLAUDE.md also stays here.) Run `node tests/demo-test.js` in both before pushing.

The test copy keeps its own saved scans on the phone, separate from the real app. It can still send to the real monday.com Inventory Recon board, so it asks for a second tap first.

---

# LCC Vehicle Scan

Little Country Cars' scan app for the Veepeak Bluetooth OBD2 scanner, on an Android phone in Chrome (138+). One app, three modes:

- **Check-In** (Dylan, recon): scan a vehicle we bought, Day-1 estimate, send to monday.com Inventory Recon.
- **Auction** (Jonathan, buying): quick appraisal, red flags, max bid, lane drive. Stays on the phone.
- **Trade** (Simon, sales): quick appraisal, test drive, trade offer with payoff/equity, customer copy. Stays on the phone.

Open https://littlecountrycars.github.io/lcc-vehicle-scan/ in Chrome → ⋮ → Add to Home screen. Pick your mode the first time; tap the name at the top to switch.

- Read-only: it never clears codes.
- No keys or customer data live here. A monday.com token is stored only on the phone that uses it.
- How the code is laid out, who owns what, and how to make changes: see `CLAUDE.md`.
