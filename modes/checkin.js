/* Check-In mode. Owner: Dylan (recon). Process sign-off: Jonathan.
   Used when a vehicle LCC already bought arrives on the lot. Posts the scan and the Day-1 estimate
   to monday.com Inventory Recon. Change wording and defaults here; the scanner itself lives in obd.js. */
(window.LCC_MODES = window.LCC_MODES || {}).checkin = {
  id: 'checkin',
  label: 'Check-In',
  title: 'Check-In',
  who: 'Dylan, recon',
  blurb: 'A vehicle we bought arrives on the lot. Scan, estimate, send to monday.com.',
  record: 'scan', records: 'scans',

  // Vehicle box
  stockLabel: 'Stock #',
  stockPlaceholder: 'Fills in from scan',
  stockFromVin: true,            // Stock # = last 6 of the VIN
  stockShort: 'stock',
  scanHint: 'Leave Miles and Stock # blank; the scan reads the VIN and, on most trucks, the mileage. Key on, engine off is the best start: the next step tests the battery while you start it.',
  quick: false,                  // the one-button "quick appraisal" is for auctions/trades

  // Drive
  lane: false,
  driveName: 'Test drive',
  driveIntro: 'Tap start <b>before</b> you pull out, set the phone in a mount, and don’t touch it while driving. Drive 10+ minutes: town, a few hard accelerations, and 30 seconds at a steady 45–65 mph. Tap End when you’re parked.',

  // Money
  money: 'estimate',             // Day-1 estimate only, no bid/offer math
  estimateName: 'Day-1 estimate',
  estimateHint: 'Prefilled with what each fix usually costs us: parts at our price (Walmart, used, RockAuto, Amazon) plus our labor. Adjust to your real numbers, remove what you won’t do, add anything else.',
  overThousand: 'Over $1,000 (or a likely big-ticket repair). Per the recon SOP, Jonathan decides fix, wholesale or sell as-is before any work starts; sending flags him in monday.com.',

  // Where results go
  destination: 'monday',
  keepDays: 30,
  keepOptions: [7, 30]
};
