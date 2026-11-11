/* Trade mode. Owner: Simon (sales).
   Valuing a customer's trade-in at the desk. Same scan and red flags as Auction, with a full test drive
   (it's on our lot, so you can take it on the road) and a trade offer instead of a max bid.
   Never touches monday.com; trade appraisals stay on the phone until shared.
   Simon: this is a working first version. Change wording and defaults here; ask Dylan before changing
   obd.js or app.js (shared by every mode), and Jonathan before changing the money math. */
(window.LCC_MODES = window.LCC_MODES || {}).trade = {
  id: 'trade',
  label: 'Trade',
  title: 'Trade',
  who: 'Simon, sales',
  blurb: 'Value a customer’s trade: scan, test drive, trade offer, customer copy.',
  record: 'trade appraisal', records: 'trade appraisals',

  stockLabel: 'Customer / deal #',
  stockPlaceholder: 'Optional',
  stockFromVin: false,
  stockShort: 'deal',
  scanHint: 'Ask the customer for the keys, plug in, key on. Miles fills in from the scan on most vehicles. Quick appraisal takes about 2 minutes; do the test drive after if you can.',
  quick: true,

  lane: false,
  driveName: 'Test drive',
  driveIntro: 'Tap start <b>before</b> you pull out, set the phone in a mount, and don’t touch it while driving. 5–10 minutes: a few firm accelerations and, if you can, 30 seconds at a steady 45–65 mph. Tap End when you’re parked.',

  money: 'bid',
  estimateName: 'Estimated recon',
  estimateHint: 'What we’d spend to make it front-line ready. Prefilled from typical parts + labor for each finding; add tires, glass, body, detail.',
  overThousand: 'Over $1,000 in likely recon, or a big-ticket repair. It’s in the offer below; if it’s a hard flag, think wholesale.',
  priceLabel: 'Expected retail sale price',
  pricePlaceholder: 'From SCOUT',
  priceHint: 'What we’d sell it for on our lot (SCOUT’s <b>expected sale price</b>). The offer takes off this vehicle’s recon and the gross we want.',
  resultName: 'Trade offer',
  feesName: 'Other costs (inspection, transport)',
  minProfit: 2500,               // gross wanted on a trade; Jonathan signs off on changes
  fees: 0,
  calls: { good: 'Good trade', watch: 'Adjust offer', problem: 'Wholesale only' },
  problemNote: 'The offer below assumes we retail it. For a wholesale-only unit, base the offer on what a wholesaler would pay instead.',
  payoff: true,                  // shows payoff and the customer's equity
  customerCopy: true,            // a plain summary for the customer, without our numbers
  scout: true,

  destination: 'phone',
  keepDays: 30,
  keepOptions: [8, 30, 90]
};
